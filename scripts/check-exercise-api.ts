import "dotenv/config";
import "reflect-metadata";
import "../src/container";
import fs from "fs";
import path from "path";
import request from "supertest";
import { container } from "tsyringe";
import app from "../src/app";
import { JwtService } from "../src/lib/jwt";

async function main() {
  const jwt = container.resolve(JwtService);
  const token = jwt.signToken("00000000-0000-0000-0000-000000000000", "check@test.com", "client");
  const auth = { Authorization: `Bearer ${token}` };

  // 1. paginate whole catalog
  const seen = new Set<string>();
  let page = 1;
  let total = -1;
  for (;;) {
    const res = await request(app).get("/api/v1/workout/exercises").query({ page, pageSize: 100 }).set(auth);
    if (res.status !== 200) { console.log(`LIST page=${page} -> ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`); break; }
    const { items, pagination } = res.body.data;
    total = pagination.total;
    items.forEach((e: any) => seen.add(e.id));
    console.log(`LIST page=${page} -> 200 items=${items.length} total=${total}`);
    if (page >= pagination.totalPages) break;
    page++;
  }

  // 2. diff vs exercises.json
  const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), "exercises.json"), "utf-8"));
  const jsonIds: string[] = raw.map((e: any) => e.id);
  const missing = jsonIds.filter((id) => !seen.has(id));
  console.log(`API serves ${seen.size}/${jsonIds.length}, missing via API: ${missing.length}`);
  missing.slice(0, 10).forEach((id) => console.log(" - missing: " + id));

  // 3. direct GET by id (first 3 + one unknown)
  for (const e of raw.slice(0, 3)) {
    const res = await request(app).get(`/api/v1/workout/exercises/${e.id}`).set(auth);
    console.log(`GET ${e.name_en} -> ${res.status}`);
  }
  const res404 = await request(app).get("/api/v1/workout/exercises/11111111-1111-1111-1111-111111111111").set(auth);
  console.log(`GET unknown uuid -> ${res404.status} (expect 404)`);
  const resBad = await request(app).get("/api/v1/workout/exercises/not-a-uuid").set(auth);
  console.log(`GET bad id -> ${resBad.status} (expect 400)`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
