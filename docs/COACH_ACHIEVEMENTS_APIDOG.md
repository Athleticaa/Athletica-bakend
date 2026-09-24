# Athletica Coach Achievements (PDF + Title) — Apidog Manual

> **Import-ready:** `api/apidog-coach-achievements.json` (OpenAPI 3.0.3). In Apidog: **Import > OpenAPI** → paste file or JSON. BaseURL `http://localhost:3000` + `https://api.athletica.app`.

---

## 1. Overview

Coaches attach **PDF certificates/achievements** (each with a **required title**) to their `coach_profiles`. Used to prove credentials to assigned clients.

**Business rules**
1. One coach → many achievements (`coach_achievements`, FK `coach_id` CASCADE).
2. Upload = `multipart/form-data` with `title` (1..200 chars, trimmed) + `pdf` (`application/pdf`, ≤10MB, non-empty).
3. Only owning coach can upload/list/delete; cross-coach access → `404 achievement_not_found`.
4. Assigned client can **read-only** list their coach's achievements via `coach_clients` resolution (no `coachId` param, no write). Unassigned → `404 no_coach_assigned`.
5. No update endpoint — replace = delete + re-upload. Max **50** achievements per coach (Cloudinary quota guard). List caps at **100** newest-first.

---

## 2. Data Model

**Prisma `coach_achievements`** (`prisma/schema.prisma`, migration `20260924000000_add_coach_achievements`)

| Field | Type | Notes |
|---|---|---|
| `id` | `String @id @default(uuid()) @db.Uuid` | PK |
| `coach_id` | `String @db.Uuid` | FK `coach_profiles.id` ON DELETE CASCADE |
| `title` | `String @db.VarChar(200)` | **Required**, trimmed 1..200 |
| `file_url` | `String @db.VarChar` | Cloudinary `secure_url` (`raw`) |
| `file_name` | `String? @db.VarChar` | `originalname` |
| `file_size` | `Int?` | `file.size` bytes |
| `mime_type` | `String @default("application/pdf") @db.VarChar` | Only `application/pdf` in v1 |
| `created_at` | `DateTime @default(now())` | Index `@@index([coach_id, created_at])` |

Back-relation: `coach_profiles.coach_achievements[]`.

**Cloudinary:** `athletica/achievements`, `resource_type: "raw"`, `public_id: coach-<coachId>-<Date.now()>`, `secure_url` persisted. Extract `publicId` handles raw extensionless URLs; `destroy(..., {resource_type:"raw"})` best-effort.

---

## 3. Endpoints (Base `/api/v1`, Bearer JWT)

All require `Authorization: Bearer <jwt>` + role guard (`authenticate` + `authorize("coach"/"client")`).

### 3.1 POST `/coach/achievements` — Upload (coach)

- **Auth:** coach only
- **Content-Type:** `multipart/form-data` (single file `pdf`)
- **Form fields:**

| Field | Type | Required | Validation |
|---|---|---|---|
| `title` | text | yes | `typeof string`, `trim().length 1..200` → `title_required` / `title_too_long` 400 |
| `pdf` | file | yes | `mimetype === application/pdf` else `achievement_invalid_file_type` 400; `size 0` → `pdf_required` 400; `>10MB` → `achievement_file_too_large` 413 (MulterError) |

- **Flow:** `getCoachProfileId(userId)` → quota `count < 50` → Cloudinary `upload_stream` (raw) → `prisma.coach_achievements.create` (orphan cleanup on DB error).
- **201 Created** example:

```json
{
  "id": "b2c3d4e5-f6a7-4890-9bcd-ef1234567890",
  "coach_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "title": "IFBB Pro Certificate 2024",
  "file_url": "https://res.cloudinary.com/demo/raw/upload/v123/athletica/achievements/coach-a1b2-1234567890123.pdf",
  "file_name": "certificate.pdf",
  "file_size": 245760,
  "mime_type": "application/pdf",
  "created_at": "2026-09-24T15:30:00.000Z"
}
```

- **Errors:** `400 title_required/title_too_long/pdf_required/achievement_invalid_file_type/achievement_limit_reached`, `401`, `403 not a coach`, `404 coach_profile_not_found`, `413 achievement_file_too_large`.

**Apidog setup:** Method POST, Auth Bearer, Body `form-data`: key `title` = Text, key `pdf` = File (select PDF). Header `Accept: application/json` optional.

**cURL:**

```bash
curl -X POST http://localhost:3000/api/v1/coach/achievements \
  -H "Authorization: Bearer <coachJWT>" \
  -F "title=IFBB Pro Certificate 2024" \
  -F "pdf=@/path/certificate.pdf;type=application/pdf"
```

### 3.2 GET `/coach/achievements` — List mine (coach)

- **Auth:** coach only
- **200 OK:**

```json
{ "achievements": [ { "id":"...", "title":"...", "file_url":"https://...", "file_name":"...", "file_size":12345, "mime_type":"application/pdf", "created_at":"..." } ] }
```

Sorted `created_at DESC`, `take 100`, own rows only. Empty → `{ "achievements": [] }`. Errors `401/403/404 coach_profile_not_found`.

### 3.3 DELETE `/coach/achievements/:id` — Delete (coach)

- **Auth:** coach only, `:id` UUID
- **200 OK:** `{ "message": "Achievement deleted successfully" }` (`achievement_deleted`)
- **Errors:** `400 invalid_uuid`, `401/403`, `404 achievement_not_found` (missing or foreign).
- **cURL:**

```bash
curl -X DELETE http://localhost:3000/api/v1/coach/achievements/b2c3d4e5-f6a7-4890-9bcd-ef1234567890 \
  -H "Authorization: Bearer <coachJWT>"
```

### 3.4 GET `/client/coach/achievements` — List assigned coach (client)

- **Auth:** client only
- **Logic:** resolve `client_profiles` by `userId` → `coach_clients.findFirst({ client_id })` → `coach_id` → `findMany` achievements `take 100` newest-first.
- **200 OK:** same shape as `3.2`.
- **Errors:** `401/403 not a client`, `404 no_coach_assigned` (no assignment), `404 client_profile_not_found/coach_profile_not_found`.

---

## 4. Validation

**`coach-achievements.validation.ts`**

| Function | Checks |
|---|---|
| `validateTitle(raw)` | `typeof string` else `title_required`; `trim()` empty → `title_required`; `>200` → `title_too_long` |
| `validateAchievementId(id)` | `string` + UUID regex else `invalid_uuid` |

**Service guards** (duplicate in case of direct call): same title checks + `file.size 0` → `pdf_required` + quota `50`.

**Multer:** `memoryStorage`, `limits: { fileSize: 10*1024*1024, files:1 }`, `fileFilter` PDF-only → `ServiceError("achievement_invalid_file_type",400)`. Global handler `src/app.ts` maps `MulterError LIMIT_FILE_SIZE` to `achievement_file_too_large` when `originalUrl` contains `/achievements` (else `file_too_large` for images).

---

## 5. Error Codes

| Key | Status | When |
|---|---|---|
| `title_required` | 400 | Missing/non-string/empty title |
| `title_too_long` | 400 | title >200 |
| `pdf_required` | 400 | No file or empty file |
| `achievement_invalid_file_type` | 400 | mimetype ≠ `application/pdf` |
| `achievement_file_too_large` | 413 | >10MB |
| `achievement_limit_reached` | 400 | ≥50 per coach |
| `invalid_uuid` | 400 | Bad `:id` |
| `achievement_not_found` | 404 | Missing or foreign id |
| `coach_profile_not_found` | 404 | No coach_profiles for user |
| `client_profile_not_found` | 404 | No client_profiles for user |
| `no_coach_assigned` | 404 | Client without assignment |
| `achievement_deleted` | 200 | Delete success message |

---

## 6. File Structure

```
prisma/
  schema.prisma (+ model coach_achievements, back-relation)
  migrations/20260924000000_add_coach_achievements/migration.sql
src/modules/coach-achievements/
  coach-achievements.service.ts       # upload/list/delete, quota 50, orphan cleanup, raw publicId
  coach-achievements.controller.ts    # @inject DI, handleError, @t translation
  coach-achievements.routes.ts        # coachAchievementsRouter + clientAchievementsRouter, multer pdf 10MB
  coach-achievements.validation.ts    # validateTitle / validateAchievementId
src/container.ts                      # register CoachAchievementsService/Controller
src/app.ts                           # mount /api/v1/coach/achievements + /api/v1/client/coach/achievements, MulterError branching
src/locales/en.json, ar.json          # pdf_required, title_*, achievement_*
api/apidog-coach-achievements.json    # Apidog OpenAPI import
docs/COACH_ACHIEVEMENTS_APIDOG.md     # This manual
specs/007-coach-achievements/*         # spec/plan/data-model/research/contracts/quickstart
```

---

## 7. Apidog Manual Steps

1. Import `api/apidog-coach-achievements.json`: **Apidog > Import > OpenAPI** → select file or paste JSON.
2. Set **Environment**: `{{baseUrl}} = http://localhost:3000` and `{{baseUrl}} = https://api.athletica.app`.
3. Set **Auth**: for each request, Header `Authorization: Bearer {{coachToken}}` (or client token for `GET /client/...`). Generate tokens via `POST /api/v1/auth/login`.
4. **Test upload:** `POST /coach/achievements` → Body form-data → `title`: `Test Cert`, `pdf`: pick small PDF (<10MB) → Send → expect `201`.
5. **Test list (coach):** `GET /coach/achievements` → expect array contains upload.
6. **Test delete:** `DELETE /coach/achievements/{id}` → expect `200`, Cloudinary asset removed (check dashboard).
7. **Test client read:** assign client to coach (`POST /coach/invite` + client `POST /coach-requests` + accept), login as client, `GET /client/coach/achievements` → expect same `file_url`/`title`.
8. **Negative tests:** non-PDF → `400 achievement_invalid_file_type`; empty title → `400 title_required`; >200 chars → `400 title_too_long`; 11MB PDF → `413 achievement_file_too_large`; second coach delete foreign id → `404`; unassigned client → `404 no_coach_assigned`.

---

## 8. Flutter Snippet

```dart
// Upload (coach)
final req = http.MultipartRequest('POST', Uri.parse('$baseUrl/coach/achievements'));
req.headers['Authorization'] = 'Bearer $coachToken';
req.fields['title'] = 'IFBB Certificate 2024';
req.files.add(await http.MultipartFile.fromPath('pdf', pdfFile.path, contentType: MediaType('application','pdf')));
final res = await req.send(); // 201 {id, title, file_url, ...}

// List (coach)
final list = await http.get(Uri.parse('$baseUrl/coach/achievements'), headers: {'Authorization':'Bearer $coachToken'});
// Client read
final clientList = await http.get(Uri.parse('$baseUrl/client/coach/achievements'), headers: {'Authorization':'Bearer $clientToken'});
```

PDF URLs are `raw` Cloudinary URLs — open directly or with `url_launcher`.

---

## 9. Notes

- Spelling is `coach_achievements` everywhere (user typed `coach_achivment` — no alias).
- `file_url` is public `secure_url`; no signed URL needed in v1. Future: signed/expiring URLs if needed.
- Prisma: `npx prisma migrate dev --name add_coach_achievements` (already generated) then `npx prisma generate`. `.specify/feature.json` uses POSIX `specs/007-coach-achievements`.
