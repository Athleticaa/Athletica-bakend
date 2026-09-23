# All Files — Before / After (Check-In Feature + Fixes)

Date: 2026-09-22
Branch state: 12 tracked-modified + new untracked checkin module, migrations, tests, docs.
Verification: `npx tsc --noEmit` exit 0, `npm test` 7 suites / 120 pass.

> This extends `CHECKIN_FIXES_BEFORE_AFTER.md` (7 bug fixes) to every file in `git status`.

---

## Tracked modifications (12 files)

### 1. `.gitignore`
**Before:** no `tmp/`, no reports ignore.
```
*.log / auth.postman_collection.json / .aider* / .vercel / .env*.local ...
```
**After:** appended:
```
tmp/
reports/apidog-sync-report.md
```
**Why:** `tmp/*.json` are local test payloads, sync report is generated. Prevent accidental commit.

---

### 2. `prisma/schema.prisma` (+92)
**Before:** `coach_profiles`, `client_profiles`, `coach_clients` had no checkin relations. No `checkin_*` models.
**After:**
- `coach_profiles += checkin_questions[], checkin_submissions[], checkin_assignments[]`
- `client_profiles += checkin_submissions[], checkin_assignments[]`
- `coach_clients += checkin_assignments[], checkin_submissions[]` (reformatted block)
- New: `enum checkin_question_type { NUMBER TEXT SINGLE_CHOICE YES_NO RATING IMAGE }`
- New: `checkin_questions` (coach_id, question[500], type, options String[], required, order, @@index[coach_id,order], Cascade)
- New: `checkin_submissions` (coach_id, client_id, coach_client_id String?, submitted_at, Cascade/SetNull, 3 indexes)
- New: `checkin_answers` (submission_id, question_id String?, answer_value Text, question_snapshot Json, Cascade/SetNull)
- New: `checkin_assignments` (coach_id, client_id, coach_client_id String?, status pending, @@unique[coach_client_id], Cascade)
**Why:** Storage for forms, submissions with snapshots, pending gate. Note: `@@unique([coach_client_id])` on nullable col does not block duplicate NULL rows in Postgres — known, benign due to `deleteMany` cleanup.

---

### 3. `src/app.ts` (+3)
**Before:**
```ts
import workoutRoutes ... / nutritionRoutes ... / profileRoutes ...
app.use("/api/v1/profile", profileRoutes);
```
**After:**
```ts
import { coachCheckInRouter, clientCheckInRouter } from "./modules/checkin/checkin.routes";
app.use("/api/v1/coach/checkin", coachCheckInRouter);
app.use("/api/v1/client/checkin", clientCheckInRouter);
```
**Why:** Mount new routers.

---

### 4. `src/container.ts` (+4)
**Before:** ends at `ProfileService/ProfileController` registration.
**After:**
```ts
import { CheckInService } from "./modules/checkin/checkin.service";
import { CheckInController } from "./modules/checkin/checkin.controller";
container.registerSingleton(CheckInService);
container.registerSingleton(CheckInController);
```
**Why:** DI for new module.

---

### 5. `src/locales/en.json`, `src/locales/ar.json` (+24 keys each)
**Before:** ends at `exercise_already_in_day`.
**After:** adds 24 keys: `checkin_question_required/too_long/type_invalid`, `checkin_options_required/invalid`, `checkin_order_invalid`, `checkin_question_not_found/cannot_delete_last/deleted`, `checkin_question_ids_required/duplicate_question_id/reorder_ids_mismatch`, `checkin_answers_required/invalid_json/answer_required`, `checkin_missing_required_answers/invalid_question_id/invalid_number/rating/choice/text_empty`, `checkin_submission_not_found/no_pending_assignment/assigned`. Arabic mirrors English.
**Why:** i18n for all new ServiceErrors/validations.

---

### 6. `src/modules/auth/auth.service.ts` (±68)
Full before/after in `CHECKIN_FIXES_BEFORE_AFTER.md §7`.
**Before:** `users.create` → `client_profiles.create` OR `coach_profiles.create` (non-transactional, no defaults) → `verification_codes.create`. Orphaned user if seeding fails.
**After:** single `$transaction`: `tx.users.create` + `tx.client_profiles.create` OR (`tx.coach_profiles.create` + `createDefaultCheckInQuestions(tx)`) + `tx.verification_codes.create`. Email send after commit. Adds `import { createDefaultCheckInQuestions }`.
**Why:** Atomic coach signup with 24 default questions.

---

### 7. `scripts/validate-routes.ts` (+17)
**Before:**
```ts
interface RouteInfo { ... file; lineNumber; } // no routerVar
/ router\.(get|post...)\("path"...\) / → method=match[1], path=match[2]
route list: [... profile, coach-assignment, client-questions] // no checkin
key = `${method}:${path}`
```
**After:**
```ts
interface RouteInfo { ... routerVar: string; }
/(\w+)\.(get|post...)\("path"...\)/ → routerVar=match[1], skip `express`, method=match[2], path=match[3]
route list += "checkin/checkin.routes.ts"
key = `${method}:${basename(file)}:${routerVar}:${path}`
// Include file + router var so coach/client check-in routers sharing same sub-path are not flagged.
```
**Why:** Old key flagged `GET /questions` / `GET /templates` etc. as duplicates across different routers/mounts. New key is mount-aware.

---

### 8. `scripts/generate-openapi.ts` (+382/-~)
**Before:** `extractRoutes` matched only `router.get/post...`, no `routerVar`, filtered only `controller` from middleware, generic `generateRequestBody`, `getTags()` from filename, no mount config.
**After:**
- `RouteInfo += routerVar`, `RouteFileConfig { file, mount, tag, routers? }`
- Regex `/(\w+)\.(get|post...)/`, skip `express`, filter `controller` + `upload`
- `getRequestBodySpec(method, fullPath, routePath)` with explicit schemas: coach `POST /questions`, `PATCH /reorder`, `PATCH /questions/:id`, `POST /assign {coach_client_id}`, client `POST /submit multipart/form-data {answers JSON-string + image files field=question_id}`, auth signup body
- Multi-router mount overrides (coach vs client checkin in same file)
**Why:** Correct OpenAPI with real mounts/tags/bodies. Fixes 13 false-positive duplicate warnings.
**Known issue (pre-existing, still open):** `getResponseContent()` / `errorBody` referenced in `generateOpenAPISpec` ~L469-474 but never defined — `npm run api:generate` throws `ReferenceError`. `tsconfig` only includes `src/**/*` so `tsc --noEmit` stays green. Needs helper restore or drop `content` fields. Committed `openapi.json` could not have been produced by this revision.

---

### 9. `scripts/sync-apidog.ts` (2 hunks)
**Before:**
```ts
`apidog import --project-id=${projectId} --file=${specPath}`
`apidog validate --project-id=${projectId}`
```
**After:**
```ts
`apidog import --project ${projectId} --format openapi --file "${specPath}" --access-token ${token}`
`apidog project get ${projectId} --access-token ${token}`
```
**Why:** Match installed Apidog CLI syntax.
**Hygiene note:** token interpolated into shell cmd (visible in `ps`/history) while already in `env`. Prefer env-only auth if CLI supports it.

---

### 10. `reports/api-validation-report.md`
**Before:** `Total issues: 13, Warnings: 13` — duplicate `POST/GET /templates`, `/plans`, `/today`, `/my/plans`, `/history` across workout/nutrition (false positives, same subpath different mount).
**After:** `Total issues: 0`, `✅ No issues found!`
**Why:** Mount-aware key in §7 is correct fix, not suppression.

---

### 11. `openapi.json` (2000+/546, ~2546-line diff)
**Before:** no `/coach/checkin/*`, `/client/checkin/*` paths, generic bodies.
**After:** regenerated with checkin paths (questions CRUD, reorder, assign, submissions, submit multipart), mount-correct tags, explicit requestBody schemas from §8. Large diff is mostly reordering + new paths.
**Why:** Contract for new feature. See known issue in §8 — regen script currently broken, so do not regen until helpers restored.

---

## New untracked — feature (not modified, no "before")

### 12. `src/modules/checkin/` (5 files, new)
- `checkin.routes.ts` (44 lines) — coach + client routers, multer memory 5MB, `files:10` cap. **Fixed:** `upload.fields([])` → `upload.any()` (see fixes doc §1).
- `checkin.controller.ts` (234 lines) — CRUD, assign, submit (multipart JSON + files), detail, hasPending. **Fixed:** array `req.files` handling.
- `checkin.service.ts` (449 lines) — question mgmt, gate, submit+validate+persist+consume, Cloudinary. **Fixed:** in-memory sort, blank-optional omit, strict NUMBER/RATING regex.
- `checkin.validation.ts` (190 lines) — create/update/reorder/assign/submit validators. **Fixed:** null guard, choice-options on update.
- `checkin-defaults.ts` (90 lines) — 24 defaults (12 NUMBER body, 3 IMAGE optional, 9 reflection), `createDefaultCheckInQuestions(tx)`.
Full before/after for all 7 bug fixes: see `CHECKIN_FIXES_BEFORE_AFTER.md`.

### 13. `prisma/migrations/` (5 new dirs)
- `20260921000000_add_checkin_module/` — base tables
- `20260922000000_add_checkin_assignments/` — pending gate
- `20260922000001_fix_checkin_cascade/` — FK onDelete
- `20260922000002_checkin_coach_client_id/` — coach_client_id link
- `20260922000003_checkin_images_optional/` — IMAGE optional
Schema-only (no INSERTs) — pre-existing coaches get no backfill, so their clients hit empty/unsatisfiable pending gate until coach creates/assigns. Confirm intended.

### 14. `tests/unit/checkin.test.ts` (7866 B), `checkin-questions-gate.test.ts` (2054 B)
New coverage: validation, pending gate. 31/31 pass. Missing (recommended): file-only submit, strict numeric (`75kg`, `Infinity`, `5.8`), blank-optional omit, in-memory order.

### 15. `CHECKIN_FEATURE_DOCS.md` (22210 B, new)
Feature design doc. No before — net new.

---

## New untracked — hygiene (do NOT commit as-is)

### 16. `scripts/apply-migration.ts`, `add-checkin-migration-record.ts`, `add-cascade-record.ts`, `fix-cascade.ts`, `check-tables.ts`
Local ops hacks. `apply-migration.ts` e.g. raw `ALTER TABLE`, applies SQL via `pg.Client`, then `INSERT INTO _prisma_migrations ... checksum 'dummy'`. Merging risks checksum drift → breaks `prisma migrate deploy` elsewhere. **Action:** keep local, delete after clean migrate, never commit.

### 17. `reports/apidog-sync-report.md` (1756 B), `tmp/*.json` (5 files)
Generated/local payloads (`create-assign.json`, `move-assign.json`, …). Now in `.gitignore` (§1). **Action:** leave untracked.

---

## Quick verify
- `npx tsc --noEmit` → 0
- `npm test` → 7 suites / 120 pass (checkin 31/31)
- Open `openapi.json` diff only to confirm new `/checkin` paths; do not regen until §8 helpers restored.
