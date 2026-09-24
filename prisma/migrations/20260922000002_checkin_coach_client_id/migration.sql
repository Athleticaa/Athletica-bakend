-- AlterTable: add coach_client_id (nullable first so existing rows survive)
ALTER TABLE "checkin_assignments" ADD COLUMN IF NOT EXISTS "coach_client_id" UUID;
ALTER TABLE "checkin_submissions" ADD COLUMN IF NOT EXISTS "coach_client_id" UUID;

-- Backfill: link existing rows to their coach_clients relationship row.
-- Rows with no matching coach_clients row keep coach_client_id NULL (orphans
-- preserved; service reads fall back to the legacy coach_id+client_id columns).
UPDATE "checkin_assignments" a SET "coach_client_id" = cc."id"
FROM "coach_clients" cc
WHERE cc."coach_id" = a."coach_id" AND cc."client_id" = a."client_id" AND a."coach_client_id" IS NULL;

UPDATE "checkin_submissions" s SET "coach_client_id" = cc."id"
FROM "coach_clients" cc
WHERE cc."coach_id" = s."coach_id" AND cc."client_id" = s."client_id" AND s."coach_client_id" IS NULL;

-- Replace old per-pair unique with per-relationship unique (NULLs allowed multiple times in PG)
DROP INDEX IF EXISTS "checkin_assignments_coach_id_client_id_key";
CREATE UNIQUE INDEX IF NOT EXISTS "checkin_assignments_coach_client_id_key" ON "checkin_assignments"("coach_client_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "checkin_assignments_coach_client_id_idx" ON "checkin_assignments"("coach_client_id");
CREATE INDEX IF NOT EXISTS "checkin_submissions_coach_client_id_idx" ON "checkin_submissions"("coach_client_id");

-- AddForeignKey: pending assignments die with the relationship (client can no
-- longer submit after unassign anyway); submission history is preserved.
DO $$ BEGIN
  ALTER TABLE "checkin_assignments" ADD CONSTRAINT "checkin_assignments_coach_client_id_fkey" FOREIGN KEY ("coach_client_id") REFERENCES "coach_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "checkin_submissions" ADD CONSTRAINT "checkin_submissions_coach_client_id_fkey" FOREIGN KEY ("coach_client_id") REFERENCES "coach_clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
