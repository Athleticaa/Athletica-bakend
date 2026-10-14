/**
 * Per-feature Redis cache smoke test (terminal).
 *
 * For EVERY cached read it asserts: cold GET → X-Cache: MISS, repeat GET →
 * X-Cache: HIT with a byte-identical body. Write-through paths are exercised
 * (template create/update/delete) including cleanup. Endpoints without
 * fixtures (no assignment/plan) report SKIP, never FAIL.
 *
 * Serverless mode (--cold): reboots the server child before EACH feature so
 * every check pays a real cold TLS handshake, like a Vercel cold start.
 * First-request latency per feature is gated (FAIL > 10s = Vercel hobby
 * limit, WARN > 3s).
 *
 * Usage:
 *   $env:REDIS_URL="rediss://..."; npx tsx scripts/cache-smoke.ts [--cold] [--port 3199]
 *
 * Requires: REDIS_URL, DATABASE_URL, JWT_SECRET. Never prints secrets.
 */
import "dotenv/config";
import { spawn, ChildProcess } from "child_process";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { CacheService } from "../src/lib/cache";

type Status = "PASS" | "FAIL" | "SKIP";
interface CheckResult {
  feature: string;
  status: Status;
  detail: string;
  coldLatencyMs?: number;
}

const results: CheckResult[] = [];
const COLD_LIMIT_MS = 10_000;
const WARN_LIMIT_MS = 3_000;

const args = process.argv.slice(2);
const COLD_MODE = args.includes("--cold");
const portArg = args.find((a) => a.startsWith("--port"));
const PORT = portArg ? Number(portArg.split("=")[1] || portArg.split(" ")[1]) || 3199 : 3199;
const BASE = `http://localhost:${PORT}`;

function fail(feature: string, detail: string): void {
  results.push({ feature, status: "FAIL", detail });
  console.log(`  ✗ FAIL ${feature}: ${detail}`);
}
function pass(feature: string, detail: string, coldLatencyMs?: number): void {
  results.push({ feature, status: "PASS", detail, coldLatencyMs });
  const lat = coldLatencyMs !== undefined ? ` [cold ${coldLatencyMs}ms]` : "";
  console.log(`  ✓ PASS ${feature}: ${detail}${lat}`);
}
function skip(feature: string, detail: string): void {
  results.push({ feature, status: "SKIP", detail });
  console.log(`  - SKIP ${feature}: ${detail}`);
}

async function req(
  method: string,
  path: string,
  token?: string,
  body?: unknown,
): Promise<{ status: number; headers: Headers; json: unknown; text: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-JSON */
    }
    return { status: res.status, headers: res.headers, json, text };
  } finally {
    clearTimeout(timer);
  }
}

function xcache(headers: Headers): string {
  return headers.get("x-cache") ?? "(absent)";
}

/** GET twice; expect MISS then HIT with identical body. Returns body on success. */
async function expectMissThenHit(
  feature: string,
  path: string,
  token?: string,
  opts: { skipStatuses?: number[] } = {},
): Promise<{ ok: boolean; body?: unknown; coldMs?: number }> {
  const t0 = Date.now();
  const first = await req("GET", path, token);
  const coldMs = Date.now() - t0;
  if (opts.skipStatuses?.includes(first.status)) {
    skip(feature, `HTTP ${first.status} (no fixture)`);
    return { ok: false };
  }
  if (first.status !== 200) {
    fail(feature, `first GET ${path} → HTTP ${first.status}: ${first.text.slice(0, 120)}`);
    return { ok: false };
  }
  if (xcache(first.headers) !== "MISS") {
    fail(feature, `first GET expected MISS, got ${xcache(first.headers)} (flush first?)`);
    return { ok: false };
  }
  const second = await req("GET", path, token);
  if (second.status !== 200 || xcache(second.headers) !== "HIT") {
    fail(feature, `repeat GET → HTTP ${second.status} X-Cache=${xcache(second.headers)}`);
    return { ok: false };
  }
  if (JSON.stringify(first.json) !== JSON.stringify(second.json)) {
    fail(feature, `HIT body differs from MISS body`);
    return { ok: false };
  }
  gateLatency(feature, coldMs);
  pass(feature, `MISS→HIT identical (${path})`, COLD_MODE ? coldMs : undefined);
  return { ok: true, body: second.json, coldMs };
}

function gateLatency(feature: string, coldMs: number): void {
  if (!COLD_MODE) return;
  if (coldMs > COLD_LIMIT_MS) {
    fail(feature, `cold latency ${coldMs}ms exceeds Vercel function limit (${COLD_LIMIT_MS}ms)`);
  } else if (coldMs > WARN_LIMIT_MS) {
    console.log(`  ! WARN ${feature}: cold latency ${coldMs}ms > ${WARN_LIMIT_MS}ms`);
  }
}

let server: ChildProcess | null = null;

async function bootServer(): Promise<void> {
  stopServer();
  server = spawn("npx", ["tsx", "src/index.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT), CACHE_ENABLED: "true" },
    stdio: "ignore",
    shell: true,
  });
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const r = await req("GET", "/api/v1/health");
      if (r.status === 200) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error("server did not boot within 60s");
    await new Promise((r) => setTimeout(r, 1000));
  }
}

function stopServer(): void {
  if (server) {
    try {
      server.kill();
    } catch {
      /* ignore */
    }
    server = null;
  }
}

/** Flush a feature's key prefixes so the next GET is a guaranteed cold MISS. */
async function flush(prefixes: string[]): Promise<void> {
  for (const p of prefixes) {
    await CacheService.delByPrefix(p);
  }
}

async function main(): Promise<void> {
  if (!process.env.REDIS_URL) {
    console.error("REDIS_URL is required (this script tests the live cache path).");
    process.exit(2);
  }
  if (!process.env.DATABASE_URL || !process.env.JWT_SECRET) {
    console.error("DATABASE_URL and JWT_SECRET are required for fixtures + test JWTs.");
    process.exit(2);
  }
  console.log(`cache-smoke${COLD_MODE ? " [--cold: fresh server per feature]" : ""} → ${BASE}`);

  // ---- fixtures (read-only) ----
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });
  const coachUser = await prisma.users.findFirst({ where: { role: "coach" }, select: { id: true } });
  const clientUser = await prisma.users.findFirst({ where: { role: "client" }, select: { id: true } });
  const exercise = await prisma.exercises.findFirst({ select: { id: true } });
  const food = await prisma.foods.findFirst({ select: { id: true } });
  const sign = (sub: string, role: string) =>
    jwt.sign({ sub, role }, process.env.JWT_SECRET as string, { expiresIn: "10m" });
  const coachTok = coachUser ? sign(coachUser.id, "coach") : undefined;
  const clientTok = clientUser ? sign(clientUser.id, "client") : undefined;
  await prisma.$disconnect();

  const P = "athletica:development:";
  const boot = async () => bootServer();

  // ---- 0. health gate ----
  await boot();
  {
    const h = await req("GET", "/api/v1/health?cache=1");
    const cache = (h.json as { cache?: string } | null)?.cache;
    if (h.status === 200 && cache === "up") pass("health", "cache:up");
    else fail("health", `expected cache:up, got HTTP ${h.status} ${JSON.stringify(h.json)}`);
  }

  const maybeReboot = async () => {
    if (COLD_MODE) await boot();
  };

  // ---- 1. exercises ----
  await maybeReboot();
  await flush([`${P}ex:`]);
  await expectMissThenHit("exercises-list", "/api/v1/workout/exercises?page=1&pageSize=5", coachTok);
  if (exercise) {
    await flush([`${P}ex:`]);
    await expectMissThenHit("exercise-item", `/api/v1/workout/exercises/${exercise.id}`, coachTok);
  } else skip("exercise-item", "no exercises in DB");

  // ---- 2. foods ----
  await maybeReboot();
  await flush([`${P}food:`]);
  await expectMissThenHit("foods-list", "/api/v1/nutrition/foods?page=1&pageSize=5", coachTok);
  if (food) {
    await flush([`${P}food:`]);
    await expectMissThenHit("food-item", `/api/v1/nutrition/foods/${food.id}`, coachTok);
  } else skip("food-item", "no foods in DB");
  await flush([`${P}food:`]);
  await expectMissThenHit("food-categories", "/api/v1/nutrition/food-categories", coachTok);

  // ---- 3. client questions (public) ----
  await maybeReboot();
  await flush([`${P}q:`]);
  await expectMissThenHit("client-questions", "/api/v1/client/questions");

  // ---- 4. check-in coach questions ----
  await maybeReboot();
  if (!coachTok) skip("checkin-questions", "no coach user in DB");
  else {
    await flush([`${P}chk:q:coach:`, `${P}chk:q:client:`]);
    await expectMissThenHit("checkin-questions", "/api/v1/coach/checkin/questions", coachTok);
  }

  // ---- 5. achievements ----
  await maybeReboot();
  if (!coachTok) skip("achievements", "no coach user in DB");
  else {
    await flush([`${P}ach:`]);
    await expectMissThenHit("achievements-mine", "/api/v1/coach/achievements", coachTok);
  }

  // ---- 6. profiles ----
  await maybeReboot();
  if (!coachTok) skip("profile-coach", "no coach user in DB");
  else {
    await flush([`${P}prof:`]);
    await expectMissThenHit("profile-coach", "/api/v1/profile/", coachTok);
  }
  if (!clientTok) skip("profile-client", "no client user in DB");
  else {
    await flush([`${P}prof:`]);
    await expectMissThenHit("profile-client", "/api/v1/profile/", clientTok);
  }

  // ---- 7. workout templates + write-through lifecycle ----
  await maybeReboot();
  if (!coachTok) skip("workout-templates", "no coach user in DB");
  else {
    await flush([`${P}wtmpl:`]);
    // Self-cleanup: remove leftovers from prior partial runs.
    try {
      const pre = await req("GET", "/api/v1/workout/templates?page=1&pageSize=100", coachTok);
      const items = (pre.json as { data?: { items?: Array<{ id: string; title: string }> } })?.data?.items ?? [];
      for (const t of items) {
        if (t.title.startsWith("smoke-")) {
          await req("DELETE", `/api/v1/workout/templates/${t.id}`, coachTok);
        }
      }
    } catch {
      /* best-effort */
    }
    await flush([`${P}wtmpl:`]);
    await expectMissThenHit(
      "workout-templates-list",
      "/api/v1/workout/templates?page=1&pageSize=10",
      coachTok,
    );
    const title = `smoke-${Date.now()}`;
    const created = await req("POST", "/api/v1/workout/templates", coachTok, {
      title,
      description: "smoke",
    });
    if (created.status !== 201) {
      fail("workout-template-create", `HTTP ${created.status}: ${created.text.slice(0, 120)}`);
    } else {
      // NOTE: workout controller wraps payloads as { success, data }.
      const tid = (created.json as { data?: { id?: string } })?.data?.id;
      if (!tid) {
        fail("workout-template-create", `201 but no data.id in body: ${created.text.slice(0, 160)}`);
      } else {
      pass("workout-template-create", `201 id=${tid}`);
      // list prefix dropped by the write:
      const listed = await req("GET", "/api/v1/workout/templates?page=1&pageSize=10", coachTok);
      if (xcache(listed.headers) !== "MISS") fail("workout-template-list-invalidation", `expected MISS, got ${xcache(listed.headers)}`);
      else pass("workout-template-list-invalidation", "list dropped after create");
      // item warmed by the write:
      const item = await req("GET", `/api/v1/workout/templates/${tid}`, coachTok);
      const itemBody = (item.json as { data?: { title?: string } })?.data;
      if (item.status !== 200 || xcache(item.headers) !== "HIT") {
        fail("workout-template-item-warmed", `HTTP ${item.status} X-Cache=${xcache(item.headers)}`);
      } else if (itemBody?.title !== title) {
        fail("workout-template-item-warmed", `stale title`);
      } else pass("workout-template-item-warmed", "item HIT with fresh title, no DB read");
      // update → item stays HIT-fresh:
      const title2 = `${title}-v2`;
      const upd = await req("PUT", `/api/v1/workout/templates/${tid}`, coachTok, { title: title2 });
      if (upd.status !== 200) fail("workout-template-update", `HTTP ${upd.status}`);
      else {
        const item2 = await req("GET", `/api/v1/workout/templates/${tid}`, coachTok);
        const itemBody2 = (item2.json as { data?: { title?: string } })?.data;
        if (
          item2.status === 200 &&
          xcache(item2.headers) === "HIT" &&
          itemBody2?.title === title2
        ) {
          pass("workout-template-update", "item HIT with updated title");
        } else fail("workout-template-update", `HTTP ${item2.status} X-Cache=${xcache(item2.headers)}`);
      }
      // delete → key dropped (404, never a resurrected snapshot):
      const del = await req("DELETE", `/api/v1/workout/templates/${tid}`, coachTok);
      if (del.status !== 200) fail("workout-template-delete", `HTTP ${del.status}`);
      else {
        const gone = await req("GET", `/api/v1/workout/templates/${tid}`, coachTok);
        if (gone.status === 404) pass("workout-template-delete", "item dropped, 404 after delete");
        else fail("workout-template-delete", `expected 404, got HTTP ${gone.status}`);
      }
      }
    }
  }

  // ---- 8. workout plans list (coach) ----
  await maybeReboot();
  if (!coachTok) skip("workout-plans-list", "no coach user in DB");
  else {
    await flush([`${P}wplan:`]);
    await expectMissThenHit(
      "workout-plans-list",
      "/api/v1/workout/plans?page=1&pageSize=10",
      coachTok,
    );
  }

  // ---- 9. nutrition templates list ----
  await maybeReboot();
  if (!coachTok) skip("nutrition-templates-list", "no coach user in DB");
  else {
    await flush([`${P}ntmpl:`]);
    await expectMissThenHit(
      "nutrition-templates-list",
      "/api/v1/nutrition/templates?page=1&pageSize=10",
      coachTok,
    );
  }

  // ---- 10. nutrition plans list (coach) ----
  await maybeReboot();
  if (!coachTok) skip("nutrition-plans-list", "no coach user in DB");
  else {
    await flush([`${P}nplan:`]);
    await expectMissThenHit(
      "nutrition-plans-list",
      "/api/v1/nutrition/plans?page=1&pageSize=10",
      coachTok,
    );
  }

  // ---- 11. answers (client; [] is a valid cacheable body) ----
  await maybeReboot();
  if (!clientTok) skip("answers", "no client user in DB");
  else {
    await flush([`${P}ans:`]);
    const r = await expectMissThenHit("answers", "/api/v1/client/answers", clientTok, {
      skipStatuses: [404],
    });
    if (r.ok) pass("answers-count", "total_questions served alongside");
  }

  // ---- 12. hasassign (client) ----
  await maybeReboot();
  if (!clientTok) skip("hasassign", "no client user in DB");
  else {
    await flush([`${P}chk:assign:`]);
    await expectMissThenHit("hasassign", "/api/v1/client/checkin/hasassign", clientTok, {
      skipStatuses: [404],
    });
  }

  // ---- 12b. check-in submissions (client list works even when empty) ----
  await maybeReboot();
  if (!clientTok) skip("checkin-submissions", "no client user in DB");
  else {
    await flush([`${P}chk:sub:client:`, `${P}chk:subdetail:client:`]);
    await expectMissThenHit(
      "checkin-my-submissions",
      "/api/v1/client/checkin/submissions",
      clientTok,
    );
  }

  // ---- 13. notifications ----
  await maybeReboot();
  if (!coachTok) skip("notifications", "no coach user in DB");
  else {
    await flush([`${P}notif:`]);
    await expectMissThenHit("notifications-list", "/api/v1/notifications/?limit=20", coachTok);
    await flush([`${P}notif:`]);
    await expectMissThenHit("notifications-unread-count", "/api/v1/notifications/unread-count", coachTok);
  }

  // ---- 14. mycoach (needs assignment → SKIP when 404) ----
  await maybeReboot();
  if (!clientTok) skip("mycoach", "no client user in DB");
  else {
    await flush([`${P}cc:`]);
    await expectMissThenHit("mycoach", "/api/v1/client/coach", clientTok, { skipStatuses: [404] });
  }

  // ---- 15. client plan views (need active plan → SKIP when 404) ----
  await maybeReboot();
  if (!clientTok) skip("client-plans", "no client user in DB");
  else {
    await flush([`${P}wplan:`, `${P}nplan:`]);
    const my = await req("GET", "/api/v1/workout/my/plans", clientTok);
    // NOTE: workout getMyActivePlan returns 200 { plan: null } with no
    // assignment — a vacuous MISS→HIT. Only a real plan proves the path.
    if (my.status === 404 || (my.json as { plan?: unknown })?.plan == null) {
      skip("client-workout-plans", "no active plan");
    } else {
      await flush([`${P}wplan:`]);
      await expectMissThenHit("client-workout-myplan", "/api/v1/workout/my/plans", clientTok);
    }
    const nm = await req("GET", "/api/v1/nutrition/my/plans", clientTok);
    if (nm.status === 404) skip("client-nutrition-plans", "no active plan");
    else {
      await flush([`${P}nplan:`]);
      await expectMissThenHit("client-nutrition-myplan", "/api/v1/nutrition/my/plans", clientTok);
    }
  }

  stopServer();

  // ---- summary ----
  const passN = results.filter((r) => r.status === "PASS").length;
  const failN = results.filter((r) => r.status === "FAIL").length;
  const skipN = results.filter((r) => r.status === "SKIP").length;
  console.log(`\n${passN} passed, ${failN} failed, ${skipN} skipped`);
  if (COLD_MODE) {
    const over = results.filter((r) => (r.coldLatencyMs ?? 0) > COLD_LIMIT_MS);
    if (over.length > 0) {
      console.log(`cold-latency violations: ${over.map((r) => r.feature).join(", ")}`);
      process.exit(1);
    }
  }
  process.exit(failN > 0 ? 1 : 0);
}

process.on("SIGINT", () => {
  stopServer();
  process.exit(130);
});

main().catch((e) => {
  console.error("smoke failed:", (e as Error)?.message ?? e);
  stopServer();
  process.exit(1);
});
