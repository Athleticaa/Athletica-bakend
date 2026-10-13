-- Single-device rule: one row per user, newest registration wins.
-- Step 1: collapse existing duplicates (e.g. reinstall created a second
-- row with a new device_id). Keep the newest row per user; the app
-- self-heals via heartbeat-404 -> re-register if we kept the wrong one.
-- Row comparison makes the survivor deterministic even on tied timestamps.
DELETE FROM "user_devices" a
USING "user_devices" b
WHERE a."user_id" = b."user_id"
  AND (a."created_at", a."id") < (b."created_at", b."id");

-- Step 2: replace the (user_id, device_id) uniqueness with user_id alone.
-- device_id stays as a regular column (heartbeat/logout identifier + audit).
DROP INDEX IF EXISTS "user_devices_user_id_device_id_key";
CREATE UNIQUE INDEX "user_devices_user_id_key" ON "user_devices"("user_id");
