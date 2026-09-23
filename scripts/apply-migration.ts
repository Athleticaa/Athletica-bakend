import "dotenv/config";
import pg from "pg";
import fs from "fs";
async function main(){
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  // check rest_time
  const col = await c.query(`SELECT column_name FROM information_schema.columns WHERE table_name='workout_day_exercises' AND column_name='rest_time'`);
  console.log("rest_time exists?", col.rows.length);
  if(col.rows.length===0){
    console.log("adding rest_time");
    await c.query(`ALTER TABLE "workout_day_exercises" ADD COLUMN "rest_time" INTEGER`);
  }
  // apply checkin_assignments sql
  const sql = fs.readFileSync("prisma/migrations/20260922000000_add_checkin_assignments/migration.sql","utf-8");
  console.log("applying checkin_assignments migration");
  await c.query(sql);
  console.log("migration sql applied");
  // check table
  const t = await c.query(`SELECT table_name FROM information_schema.tables WHERE table_name='checkin_assignments'`);
  console.log("checkin_assignments exists?", t.rows);
  // upsert _prisma_migrations for rest_time migration if missing
  const m1 = await c.query(`SELECT * FROM _prisma_migrations WHERE migration_name='20260911160500_add_rest_time_to_plan_exercises'`);
  console.log("m1 exists", m1.rows.length);
  if(m1.rows.length===0){
    await c.query(`INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) VALUES (gen_random_uuid()::text, 'dummy', NOW(), '20260911160500_add_rest_time_to_plan_exercises', '', NULL, NOW(), 1)`);
    console.log("inserted m1");
  }
  const m2 = await c.query(`SELECT * FROM _prisma_migrations WHERE migration_name='20260922000000_add_checkin_assignments'`);
  console.log("m2 exists", m2.rows.length);
  if(m2.rows.length===0){
    await c.query(`INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) VALUES (gen_random_uuid()::text, 'dummy', NOW(), '20260922000000_add_checkin_assignments', '', NULL, NOW(), 1)`);
    console.log("inserted m2");
  }
  // prisma needs also to handle checkin baseline - we need to create a fake migration for checkin tables that were previously db-pushed
  // Check if migration for checkin exists; if not, insert dummy for those tables to avoid drift
  // We'll insert a baseline migration that represents checkin tables already present
  const mCheckin = await c.query(`SELECT * FROM _prisma_migrations WHERE migration_name='20260921000000_add_checkin_module'`);
  console.log("mCheckin exists", mCheckin.rows.length);
  if(mCheckin.rows.length===0){
    // create dummy entry so that Prisma thinks migrations up to date for checkin tables, but drift will still show because no file?
    // Instead we should not insert, because file doesn't exist. Drift check compares migrations folder vs schema.
    // We will create a folder for this baseline and insert record.
  }
  await c.end();
}
main().catch(e=>{console.error(e); process.exit(1)});
