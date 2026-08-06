-- Reject pending requests for clients who currently hold more than one
-- assignment, except the request to the coach whose assignment is kept
-- (the most recently created one per client).
UPDATE "coach_requests"
SET "status" = 'rejected', "rejected_at" = CURRENT_TIMESTAMP
WHERE "status" = 'pending'
  AND "client_id" IN (
    SELECT "client_id" FROM "coach_clients" GROUP BY "client_id" HAVING COUNT(*) > 1
  )
  AND ("coach_id", "client_id") NOT IN (
    SELECT DISTINCT ON ("client_id") "coach_id", "client_id"
    FROM "coach_clients"
    ORDER BY "client_id", "created_at" DESC, "id" DESC
  );

-- Keep only the most recent assignment per client, dropping older ones so
-- the unique index below can be created.
DELETE FROM "coach_clients" a
USING "coach_clients" b
WHERE a."client_id" = b."client_id"
  AND (
    a."created_at" < b."created_at"
    OR (a."created_at" = b."created_at" AND a."id" < b."id")
  );

-- DropIndex
-- The (coach_id, client_id) pair is implied by the client_id unique index.
DROP INDEX "coach_clients_coach_id_client_id_key";

-- CreateIndex
-- Plain index to keep coach-side lookups (listClients/removeClient) fast.
CREATE INDEX "coach_clients_coach_id_idx" ON "coach_clients"("coach_id");

-- CreateIndex
-- Enforces the one-coach-per-client invariant at the database level.
CREATE UNIQUE INDEX "coach_clients_client_id_key" ON "coach_clients"("client_id");
