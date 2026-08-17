-- Add username to users (with backfill), move profile_image to role profiles

-- Backfill role-profile images from the users column being removed
UPDATE "coach_profiles" cp
SET "profile_image" = u."profile_image"
FROM "users" u
WHERE cp."user_id" = u."id"
  AND u."profile_image" IS NOT NULL
  AND cp."profile_image" IS NULL;

UPDATE "client_profiles" cp
SET "profile_image" = u."profile_image"
FROM "users" u
WHERE cp."user_id" = u."id"
  AND u."profile_image" IS NOT NULL
  AND cp."profile_image" IS NULL;

-- Add username with a deterministic, guaranteed-unique backfill derived from the email
ALTER TABLE "users" ADD COLUMN "username" VARCHAR;

UPDATE "users"
SET "username" = LEFT(SPLIT_PART("email", '@', 1), 91) || '-' || LEFT("id"::text, 8)
WHERE "username" IS NULL;

ALTER TABLE "users"
ALTER COLUMN "username" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- Drop removed columns
ALTER TABLE "users"
DROP COLUMN "first_name",
DROP COLUMN "last_name",
DROP COLUMN "profile_image";
