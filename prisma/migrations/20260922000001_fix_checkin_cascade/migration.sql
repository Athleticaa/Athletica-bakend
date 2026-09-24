-- Alter foreign keys to CASCADE for checkin cleanup
ALTER TABLE "checkin_questions" DROP CONSTRAINT IF EXISTS "checkin_questions_coach_id_fkey";
ALTER TABLE "checkin_questions" ADD CONSTRAINT "checkin_questions_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "coach_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "checkin_submissions" DROP CONSTRAINT IF EXISTS "checkin_submissions_coach_id_fkey";
ALTER TABLE "checkin_submissions" ADD CONSTRAINT "checkin_submissions_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "coach_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "checkin_submissions" DROP CONSTRAINT IF EXISTS "checkin_submissions_client_id_fkey";
ALTER TABLE "checkin_submissions" ADD CONSTRAINT "checkin_submissions_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "client_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
