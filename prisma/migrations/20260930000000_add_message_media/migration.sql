-- AlterTable: extend messages with media columns (009-message-media)
ALTER TABLE "messages" ADD COLUMN "message_type" VARCHAR NOT NULL DEFAULT 'text';
ALTER TABLE "messages" ADD COLUMN "attachment_url" VARCHAR;
ALTER TABLE "messages" ADD COLUMN "attachment_mime" VARCHAR;
ALTER TABLE "messages" ADD COLUMN "attachment_size" INTEGER;
ALTER TABLE "messages" ADD COLUMN "attachment_duration_sec" INTEGER;
ALTER TABLE "messages" ALTER COLUMN "content" DROP NOT NULL;
