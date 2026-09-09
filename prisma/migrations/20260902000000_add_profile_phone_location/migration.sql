-- AlterTable: Add phone_number and location to coach_profiles and client_profiles
ALTER TABLE "coach_profiles" ADD COLUMN "phone_number" VARCHAR;
ALTER TABLE "coach_profiles" ADD COLUMN "location" VARCHAR;
ALTER TABLE "client_profiles" ADD COLUMN "phone_number" VARCHAR;
ALTER TABLE "client_profiles" ADD COLUMN "location" VARCHAR;
