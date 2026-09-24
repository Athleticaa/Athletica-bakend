# Manual Import to Apidog (Project 1440503)

The CLI sync is blocked on permissions (`No project maintainer privilege`), so import the spec by hand. Takes ~5 minutes.

## Option A — Import the OpenAPI spec (recommended, covers all 84 paths)

1. Open Apidog (desktop or web) → select project **1440503**.
2. Go to **Settings → Import**, or click **+ → Import** in the left sidebar.
3. Choose **OpenAPI / Swagger**, upload this repo file: **`openapi.json`** (repo root).
4. Import settings:
   - **Import mode**: `Overwrite` (or `Merge` if the project already has endpoints you want to keep — Overwrite is cleaner since this file is generated from the code).
   - **Sync / auto-update**: leave off (one-time manual import).
5. Click **Import**. Verify these 4 new endpoints appear:
   - `GET /api/v1/workout/streak` (client)
   - `GET /api/v1/workout/clients/{coachClientId}/streak` (coach)
   - `GET /api/v1/nutrition/streak` (client)
   - `GET /api/v1/nutrition/clients/{coachClientId}/streak` (coach)

## Option B — Import Postman collections (richer examples)

Same **Import** screen → choose **Postman**, upload:
- `postman/workout-module.postman_collection.json` → contains folders **"Client Streak - Client only"** and **"Client Streak - Coach only"**
- `postman/nutrition.postman_collection.json` → contains **"Client Streak"** requests inside **"Client Endpoints"** plus **"Client Streak - Coach only"**

## After import — configure and test

1. **Environment**: create/use an environment with:
   - `baseUrl` = `http://localhost:3000/api/v1` (or your deployed URL)
   - `authToken` = a real client JWT (for client routes) and a coach JWT (for coach routes)
   - `coachClientId` = a `coach_clients.id` from your DB (coach routes are keyed by it)
2. **Auth**: each request already sends `Authorization: Bearer {{authToken}}`.
3. **Smoke test**:
   - `GET {{baseUrl}}/workout/streak` as client → expect `200 { success, data: { days[], current_streak, … } }`, or `404` if that client has no assignment.
   - `GET {{baseUrl}}/workout/clients/{{coachClientId}}/streak` as coach → `200` for own client, `404` for a foreign id, `400` for a malformed UUID.
   - Same two checks under `/nutrition/...`.
4. **Day statuses**: workout days are `completed` / `missed` / `rest` with `total_exercises` / `completed_exercises` counts; nutrition days are `completed` / `missed` with `total_meals` / `completed_meals` counts.

## Regenerating the files later

After future backend changes, refresh the import sources:
- `npm run api:validate` — route sanity check
- `openapi.json` — normally via `npm run api:generate` (currently broken upstream: `getResponseContent is not defined` in `scripts/generate-openapi.ts`; until fixed, add paths to `openapi.json` by hand in the existing style)
- Postman collections in `postman/` are maintained by hand
- Then re-import (Option A or B) into project 1440503.

## Unblocking the automatic sync (for later)

`npm run api:sync` reads project id + token from `.opencode/mcp.json` (`athletica-api` server). It currently fails because the token's account is not a member of project 1440503. Fix: in Apidog add that account to the project with **Maintainer** role (or regenerate the token from a member account), update `APIDOG_ACCESS_TOKEN`, re-run the sync.
