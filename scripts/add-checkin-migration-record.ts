import "dotenv/config";
import pg from "pg";
async function main(){
  const c = new pg.Client({connectionString: process.env.DATABASE_URL});
  await c.connect();
  const r = await c.query(`SELECT migration_name FROM _prisma_migrations WHERE migration_name='20260921000000_add_checkin_module'`);
  if(r.rows.length===0){
    await c.query(`INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) VALUES (gen_random_uuid()::text, 'dummy', NOW(), '20260921000000_add_checkin_module', '', NULL, NOW(), 1)`);
    console.log("inserted checkin module migration");
  } else console.log("already exists");
  await c.end();
}
main();
