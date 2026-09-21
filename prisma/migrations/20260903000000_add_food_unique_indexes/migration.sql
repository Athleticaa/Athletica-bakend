-- Create unique indexes to prevent future repetition foods
-- These were applied live via add_unique.ts and are idempotent
CREATE UNIQUE INDEX IF NOT EXISTS "foods_name_ar_unique_idx" ON "foods"((LOWER(TRIM("name_ar"))));
CREATE UNIQUE INDEX IF NOT EXISTS "foods_name_en_unique_idx" ON "foods"((LOWER(TRIM("name_en"))));
