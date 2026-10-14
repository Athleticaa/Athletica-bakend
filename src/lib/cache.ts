import { createHash } from "crypto";
import Redis from "ioredis";
import { config } from "../config";
import { withTimeout } from "./with-timeout";

// ── CacheService ─────────────────────────────────────────────────────────────
// Get-through / refresh-through cache backed by Upstash Redis (RESP over TLS).
// Contract: specs/011-upstash-redis-cache/contracts/cache-service.md
//
// Rules:
// - This is the ONLY module that imports ioredis. Services use CacheService.
// - Fail-open: every Redis command is timeout-bounded; cache errors are logged
//   and never thrown. Loader (DB) errors propagate untouched.
// - Disabled-clean: when REDIS_URL is unset or CACHE_ENABLED=false, all calls
//   short-circuit to the loader with zero Redis commands (CI/local safe).

export type Loader<T> = () => Promise<T>;

export interface CacheHit<T> {
  value: T;
  /** true = served from Redis, false = loaded from DB (miss/disabled/error) */
  hit: boolean;
}

const PREFIX = `athletica:${process.env.NODE_ENV || "development"}:`;

function client(): Redis | null {
  if (!config.cache.enabled) return null;
  const url = config.cache.redisUrl;
  if (!url) return null;
  const store = globalThis as unknown as { __athleticaRedis?: Redis };
  if (!store.__athleticaRedis) {
    store.__athleticaRedis = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
      // Serverless fail-fast: never auto-reconnect a dead client (the fail-open
      // path drops it so the next call redials). The offline queue stays ENABLED
      // so first commands wait for the TLS handshake instead of racing it.
      enableOfflineQueue: true,
      retryStrategy: () => null,
    });
    store.__athleticaRedis.on("error", (err) => {
      console.warn("[cache] redis error:", (err as Error)?.message ?? err);
    });
  }
  return store.__athleticaRedis;
}

function dropClient(r: Redis): void {
  try {
    r.disconnect();
  } catch {
    /* ignore */
  }
  delete (globalThis as unknown as { __athleticaRedis?: Redis }).__athleticaRedis;
}

/**
 * Cold TLS handshakes legitimately take longer than a warm command, so the
 * first-use connect gets its own generous budget. Warm commands stay at
 * commandTimeoutMs. Failure → drop the client (next call redials).
 *
 * Concurrent callers share ONE connect attempt: ioredis throws
 * ("already connecting") if connect() is invoked twice, so without sharing,
 * burst traffic would disconnect the in-flight handshake and the client
 * would never establish (every request MISSes despite a healthy server).
 */
let connectPromise: Promise<boolean> | null = null;

/**
 * The library mutates `status` at any time (connects/drops between awaits),
 * which defeats TS control-flow narrowing — always read it fresh via this
 * helper instead of comparing `r.status` inline after an early return.
 */
function isReady(r: Redis): boolean {
  return (r.status as string) === "ready";
}

async function ensureConnected(r: Redis): Promise<boolean> {
  if (isReady(r)) return true;
  if (connectPromise) {
    try {
      await withTimeout(connectPromise, config.cache.connectTimeoutMs, "cache:connect");
    } catch {
      return false;
    }
    // The initiator may have dropped this client on failure — only reuse it
    // if it is ready AND still the live singleton (never create one here).
    const live = (globalThis as unknown as { __athleticaRedis?: Redis }).__athleticaRedis;
    return isReady(r) && live === r;
  }
  connectPromise = (async () => {
    try {
      await withTimeout(r.connect(), config.cache.connectTimeoutMs, "cache:connect");
      return true;
    } catch (err) {
      console.warn("[cache] connect failed, falling back to DB:", (err as Error)?.message ?? err);
      dropClient(r);
      return false;
    } finally {
      connectPromise = null;
    }
  })();
  return connectPromise;
}

async function cmd<T>(label: string, run: (r: Redis) => Promise<T>): Promise<T | null> {
  const r = client();
  if (!r) return null;
  if (!(await ensureConnected(r))) return null;
  try {
    return await withTimeout(run(r), config.cache.commandTimeoutMs, `cache:${label}`);
  } catch (err) {
    console.warn(`[cache] ${label} failed, falling back to DB:`, (err as Error)?.message ?? err);
    dropClient(r);
    return null;
  }
}

function toJson(value: unknown): string {
  return JSON.stringify(value);
}

function fromJson<T>(raw: string | null): T | null {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Stable stringify: sorted keys, so equal queries hash to equal keys. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function hashQuery(normalized: unknown): string {
  return createHash("sha1").update(stable(normalized)).digest("hex").slice(0, 16);
}

/** Value for the X-Cache response header on cached GETs. */
export function cacheHeader(hit: boolean): "HIT" | "MISS" | "DISABLED" {
  if (!config.cache.enabled || !config.cache.redisUrl) return "DISABLED";
  return hit ? "HIT" : "MISS";
}

export const cacheKeys = {
  prefix: PREFIX,
  exerciseList: (hash: string) => `${PREFIX}ex:list:${hash}`,
  exerciseItem: (id: string) => `${PREFIX}ex:item:${id}`,
  foodList: (hash: string) => `${PREFIX}food:list:${hash}`,
  foodItem: (id: string) => `${PREFIX}food:item:${id}`,
  foodCategories: () => `${PREFIX}food:cats`,
  questions: (lang: string) => `${PREFIX}q:lang:${lang}`,
  questionCount: (lang: string) => `${PREFIX}q:count:${lang}`,
  answers: (clientId: string, lang: string) => `${PREFIX}ans:${clientId}:${lang}`,
  checkinQuestions: (coachId: string) => `${PREFIX}chk:q:coach:${coachId}`,
  checkinClientQuestions: (clientId: string) => `${PREFIX}chk:q:client:${clientId}`,
  checkinClientQuestionsPrefix: () => `${PREFIX}chk:q:client:`,
  workoutTemplateList: (coachId: string, hash: string) => `${PREFIX}wtmpl:${coachId}:list:${hash}`,
  workoutTemplateListPrefix: (coachId: string) => `${PREFIX}wtmpl:${coachId}:list:`,
  // Item keys embed the owner: a HIT must never skip the loader's ownership
  // check (coach A must not read coach B's cached row via a guessed uuid).
  workoutTemplateItem: (coachId: string, id: string) => `${PREFIX}wtmpl:item:${coachId}:${id}`,
  workoutPlanList: (coachId: string, hash: string) => `${PREFIX}wplan:${coachId}:list:${hash}`,
  workoutPlanListPrefix: (coachId: string) => `${PREFIX}wplan:${coachId}:list:`,
  workoutPlanItem: (coachId: string, id: string) => `${PREFIX}wplan:item:${coachId}:${id}`,
  workoutPlanMine: (clientId: string) => `${PREFIX}wplan:me:${clientId}`,
  workoutPlanDetail: (clientId: string, id: string) => `${PREFIX}wplan:detail:${clientId}:${id}`,
  nutritionTemplateList: (coachId: string, hash: string) => `${PREFIX}ntmpl:${coachId}:list:${hash}`,
  nutritionTemplateListPrefix: (coachId: string) => `${PREFIX}ntmpl:${coachId}:list:`,
  nutritionTemplateItem: (coachId: string, id: string, lang: string) => `${PREFIX}ntmpl:item:${coachId}:${id}:${lang}`,
  nutritionTemplateItemPrefix: (coachId: string, id: string) => `${PREFIX}ntmpl:item:${coachId}:${id}:`,
  nutritionPlanList: (coachId: string, hash: string) => `${PREFIX}nplan:${coachId}:list:${hash}`,
  nutritionPlanListPrefix: (coachId: string) => `${PREFIX}nplan:${coachId}:list:`,
  nutritionPlanItem: (coachId: string, id: string, lang: string) => `${PREFIX}nplan:item:${coachId}:${id}:${lang}`,
  nutritionPlanItemPrefix: (coachId: string, id: string) => `${PREFIX}nplan:item:${coachId}:${id}:`,
  nutritionPlanMine: (clientId: string) => `${PREFIX}nplan:me:${clientId}`,
  nutritionPlanDetail: (clientId: string, id: string, lang: string) => `${PREFIX}nplan:detail:${clientId}:${id}:${lang}`,
  nutritionPlanDetailPrefix: (clientId: string, id: string) => `${PREFIX}nplan:detail:${clientId}:${id}:`,
  coachRequests: (coachId: string) => `${PREFIX}cc:req:${coachId}`,
  coachClients: (coachId: string) => `${PREFIX}cc:list:${coachId}`,
  coachClientItem: (clientId: string, lang: string) => `${PREFIX}cc:item:${clientId}:${lang}`,
  coachClientItemPrefix: (clientId: string) => `${PREFIX}cc:item:${clientId}:`,
  myCoach: (clientId: string) => `${PREFIX}cc:mycoach:${clientId}`,
  hasassign: (clientId: string) => `${PREFIX}chk:assign:${clientId}`,
  checkinSubmissions: (clientId: string) => `${PREFIX}chk:sub:client:${clientId}`,
  checkinCoachSubmissions: (coachId: string, coachClientId: string) =>
    `${PREFIX}chk:sub:coach:${coachId}:${coachClientId}`,
  checkinCoachSubmissionsPrefix: (coachId: string) => `${PREFIX}chk:sub:coach:${coachId}:`,
  // Submission details are immutable (no edit/delete endpoints) → long TTL.
  checkinSubmissionDetail: (clientId: string, id: string) => `${PREFIX}chk:subdetail:client:${clientId}:${id}`,
  checkinCoachSubmissionDetail: (coachId: string, coachClientId: string, id: string) =>
    `${PREFIX}chk:subdetail:coach:${coachId}:${coachClientId}:${id}`,
  checkinCoachSubmissionDetailPrefix: (coachId: string, coachClientId: string) =>
    `${PREFIX}chk:subdetail:coach:${coachId}:${coachClientId}:`,
  notificationList: (userId: string, hash: string) => `${PREFIX}notif:${userId}:list:${hash}`,
  notificationListPrefix: (userId: string) => `${PREFIX}notif:${userId}:list:`,
  notificationCount: (userId: string) => `${PREFIX}notif:${userId}:count`,
  achievements: (coachId: string) => `${PREFIX}ach:coach:${coachId}`,
  profile: (userId: string) => `${PREFIX}prof:${userId}`,
};

async function getOrSet<T>(key: string, ttlSec: number, loader: Loader<T>): Promise<CacheHit<T>> {
  const cached = await cmd("get", (r) => r.get(key));
  const parsed = fromJson<T>(cached);
  if (parsed !== null) return { value: parsed, hit: true };
  const value = await loader();
  // Best-effort populate; never fail the request.
  await cmd("set", (r) => r.set(key, toJson(value), "EX", ttlSec).then(() => true));
  return { value, hit: false };
}

async function refresh<T>(key: string, ttlSec: number, loader: Loader<T>): Promise<void> {
  let value: T;
  try {
    value = await loader();
  } catch (err) {
    // The write already committed: never turn it into a 500, but don't leave
    // the stale value cached either — delete so the next read is a MISS.
    console.warn("[cache] refresh loader failed, dropping stale key:", (err as Error)?.message ?? err);
    await del(key);
    return;
  }
  await cmd("set", (r) => r.set(key, toJson(value), "EX", ttlSec).then(() => true));
}

async function getJson<T>(key: string): Promise<T | null> {
  return fromJson<T>(await cmd("get", (r) => r.get(key)));
}

async function setJson(key: string, value: unknown, ttlSec: number): Promise<void> {
  await cmd("set", (r) => r.set(key, toJson(value), "EX", ttlSec).then(() => true));
}

async function del(key: string): Promise<void> {
  await cmd("del", (r) => r.del(key).then(() => true));
}

async function delByPrefix(prefix: string): Promise<void> {
  // Best-effort by design: bounded SCAN (10 rounds × 200 keys) under the
  // command timeout. Per-prefix key counts here are tiny (per-coach lists,
  // per-item lang variants), so a full sweep is the norm; if Redis is slow
  // the loop exits early and short TTLs bound any residual staleness.
  const r = client();
  if (!r) return;
  if (!(await ensureConnected(r))) return;
  try {
    await withTimeout(
      (async () => {
        let cursor = "0";
        for (let round = 0; round < 10; round++) {
          const [next, keys] = await r.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 200);
          cursor = next;
          if (keys.length > 0) await r.unlink(...keys);
          if (cursor === "0") break;
        }
      })(),
      config.cache.commandTimeoutMs,
      "cache:delByPrefix",
    );
  } catch (err) {
    console.warn("[cache] delByPrefix failed:", (err as Error)?.message ?? err);
    dropClient(r);
  }
}

async function ping(): Promise<"up" | "down" | "disabled"> {
  const r = client();
  if (!r) return "disabled";
  if (!(await ensureConnected(r))) return "down";
  try {
    await withTimeout(r.ping(), config.cache.commandTimeoutMs, "cache:ping");
    return "up";
  } catch {
    dropClient(r);
    return "down";
  }
}

export const CacheService = {
  isEnabled: () => config.cache.enabled && Boolean(config.cache.redisUrl),
  getOrSet,
  refresh,
  getJson,
  setJson,
  del,
  delByPrefix,
  ping,
  hashQuery,
};

export type CacheServiceType = typeof CacheService;
