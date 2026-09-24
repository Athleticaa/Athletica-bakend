-- CreateTable
CREATE TABLE IF NOT EXISTS "checkin_assignments" (
    "id" UUID NOT NULL,
    "coach_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "status" VARCHAR NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checkin_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "checkin_assignments_coach_id_client_id_key" ON "checkin_assignments"("coach_id", "client_id");
CREATE INDEX IF NOT EXISTS "checkin_assignments_coach_id_idx" ON "checkin_assignments"("coach_id");
CREATE INDEX IF NOT EXISTS "checkin_assignments_client_id_idx" ON "checkin_assignments"("client_id");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "checkin_assignments" ADD CONSTRAINT "checkin_assignments_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "coach_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "checkin_assignments" ADD CONSTRAINT "checkin_assignments_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "client_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
