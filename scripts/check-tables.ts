import "dotenv/config";
import pg from "pg";
async function main(){
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const r = await c.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'checkin%' ORDER BY table_name");
  console.log(JSON.stringify(r.rows, null, 2));
  const r2 = await c.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name");
  console.log("ALL:", r2.rows.map((x:any)=>x.table_name).join(", "));
  await c.end();
}
main();
