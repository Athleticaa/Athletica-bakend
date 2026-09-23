import "dotenv/config";
import pg from "pg";
async function main(){
  const c = new pg.Client({connectionString: process.env.DATABASE_URL});
  await c.connect();
  // Drop and recreate constraints with cascade
  const queries = [
    `ALTER TABLE "checkin_questions" DROP CONSTRAINT IF EXISTS "checkin_questions_coach_id_fkey"`,
    `ALTER TABLE "checkin_questions" ADD CONSTRAINT "checkin_questions_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "coach_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    `ALTER TABLE "checkin_submissions" DROP CONSTRAINT IF EXISTS "checkin_submissions_coach_id_fkey"`,
    `ALTER TABLE "checkin_submissions" ADD CONSTRAINT "checkin_submissions_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "coach_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    `ALTER TABLE "checkin_submissions" DROP CONSTRAINT IF EXISTS "checkin_submissions_client_id_fkey"`,
    `ALTER TABLE "checkin_submissions" ADD CONSTRAINT "checkin_submissions_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "client_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  ];
  for(const q of queries){
    console.log(q);
    await c.query(q);
  }
  console.log("cascade fixed");
  // also need to ensure checkin_answers and assignments already cascade, but verify
  await c.end();
}
main().catch(e=>{console.error(e); process.exit(1)});
