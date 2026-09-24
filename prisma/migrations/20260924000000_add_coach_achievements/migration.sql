-- CreateTable
CREATE TABLE "coach_achievements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "coach_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "file_url" VARCHAR NOT NULL,
    "file_name" VARCHAR,
    "file_size" INTEGER,
    "mime_type" VARCHAR NOT NULL DEFAULT 'application/pdf',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coach_achievements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "coach_achievements_coach_id_created_at_idx" ON "coach_achievements"("coach_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "coach_achievements" ADD CONSTRAINT "coach_achievements_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "coach_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
