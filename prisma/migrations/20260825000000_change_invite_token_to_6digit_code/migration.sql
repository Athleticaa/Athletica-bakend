-- Rename active_invite_token to active_invite_code
ALTER TABLE "coach_profiles" RENAME COLUMN "active_invite_token" TO "active_invite_code";

-- Rename active_invite_token_expires_at to active_invite_code_expires_at
ALTER TABLE "coach_profiles" RENAME COLUMN "active_invite_token_expires_at" TO "active_invite_code_expires_at";

-- Enforce 6-char limit on invite codes
ALTER TABLE "coach_profiles" ALTER COLUMN "active_invite_code" TYPE VARCHAR(6);

-- CreateIndex
CREATE INDEX "coach_profiles_active_invite_code_idx" ON "coach_profiles"("active_invite_code");
