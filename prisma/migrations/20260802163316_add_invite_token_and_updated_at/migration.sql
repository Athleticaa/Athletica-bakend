-- AlterTable
ALTER TABLE "coach_profiles" ADD COLUMN     "active_invite_token" VARCHAR,
ADD COLUMN     "active_invite_token_expires_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "coach_requests" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
