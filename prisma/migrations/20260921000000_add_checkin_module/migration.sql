-- CreateEnum
CREATE TYPE "checkin_question_type" AS ENUM ('NUMBER', 'TEXT', 'SINGLE_CHOICE', 'YES_NO', 'RATING', 'IMAGE');

-- CreateTable
CREATE TABLE IF NOT EXISTS "checkin_questions" (
    "id" UUID NOT NULL,
    "coach_id" UUID NOT NULL,
    "question" VARCHAR(500) NOT NULL,
    "type" "checkin_question_type" NOT NULL,
    "options" TEXT[] NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checkin_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "checkin_submissions" (
    "id" UUID NOT NULL,
    "coach_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checkin_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "checkin_answers" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "question_id" UUID,
    "answer_value" TEXT NOT NULL,
    "question_snapshot" JSONB NOT NULL,

    CONSTRAINT "checkin_answers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "checkin_questions_coach_id_order_idx" ON "checkin_questions"("coach_id", "order");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "checkin_submissions_coach_id_client_id_idx" ON "checkin_submissions"("coach_id", "client_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "checkin_submissions_client_id_idx" ON "checkin_submissions"("client_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "checkin_answers_submission_id_idx" ON "checkin_answers"("submission_id");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "checkin_questions" ADD CONSTRAINT "checkin_questions_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "coach_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "checkin_submissions" ADD CONSTRAINT "checkin_submissions_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "coach_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "checkin_submissions" ADD CONSTRAINT "checkin_submissions_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "client_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "checkin_answers" ADD CONSTRAINT "checkin_answers_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "checkin_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "checkin_answers" ADD CONSTRAINT "checkin_answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "checkin_questions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
