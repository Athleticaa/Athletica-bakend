# Check-In Module — Changes Before / After

Date: 2026-09-22
Scope: `src/modules/checkin/`, `src/modules/auth/auth.service.ts`, `.gitignore`
Verification: `npx tsc --noEmit` clean, `npm test` 7 suites / 120 tests pass.

---

## 1. Critical — Multer rejected all image uploads

**Files:**
- `src/modules/checkin/checkin.routes.ts:11-22,41`
- `src/modules/checkin/checkin.controller.ts:179-191`
- `src/app.ts:46-50` (error mapping, unchanged)

**Problem:**
Field names are dynamic question UUIDs. `upload.fields([])` allows zero fields, so any file triggers `MulterError('LIMIT_UNEXPECTED_FILE')` → 400 `invalid_upload`. Controller never runs. After switching to `upload.any()`, a second bug appears: `upload.any()` gives `req.files` as an array, but controller treated it as `{ [fieldname]: File[] }`, so `Object.entries(array)` yields `"0","1"` and UUID check always fails.

**Before — `checkin.routes.ts`:**
```ts
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 }, // 5 MB per file
  fileFilter: (_req, file, cb) => { /* ... */ },
});
// ...
clientCheckInRouter.post("/submit", authenticate, authorize("client"), upload.fields([]), controller.submitCheckIn);
```

**After — `checkin.routes.ts`:**
```ts
// NOTE: field names are dynamic question UUIDs, so we cannot use upload.fields([...]).
// upload.any() accepts any field name; controller filters by UUID.
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024, files: 10 }, // 5 MB per file, max 10 files
  fileFilter: (_req, file, cb) => { /* ... */ },
});
// ...
clientCheckInRouter.post("/submit", authenticate, authorize("client"), upload.any(), controller.submitCheckIn);
```

**Before — `checkin.controller.ts`:**
```ts
const uploadedImages: Record<string, string> = {};
const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;

if (files) {
  for (const [fieldName, fileArr] of Object.entries(files)) {
    if (v.isValidUuid(fieldName) && fileArr?.[0]) {
      const url = await this.service.uploadCheckInPhoto(fileArr[0]);
      uploadedImages[fieldName] = url;
    }
  }
}
```

**After — `checkin.controller.ts`:**
```ts
// NOTE: upload.any() populates req.files as an array, not a dict.
const uploadedImages: Record<string, string> = {};
const files = (req.files as Express.Multer.File[] | undefined) ?? [];

for (const file of files) {
  // Field name must be a valid UUID (= a question_id for an IMAGE question)
  if (v.isValidUuid(file.fieldname)) {
    const url = await this.service.uploadCheckInPhoto(file);
    uploadedImages[file.fieldname] = url;
  }
}
```

**Why:** Allows any UUID field name, correctly reads array shape, caps at 10 files.

---

## 2. High — JSONB sorting scrambled answer order

**Files:**
- `src/modules/checkin/checkin.service.ts:157-183` (`getSubmissionDetail`)
- `src/modules/checkin/checkin.service.ts:368-377` (`getMySubmissionDetail`)

**Problem:**
`orderBy: { question_snapshot: "asc" }` orders by Postgres JSONB key order (`options`, `order`, `question`, …). `options` is compared first, so Q19 (3 options) can sort before Q17/Q18. Prisma cannot `orderBy` a nested JSON path.

**Before:**
```ts
answers: {
  orderBy: { question_snapshot: "asc" },
},
});
if (!submission) throw new ServiceError("checkin_submission_not_found", 404);
return submission;
```
```ts
// getMySubmissionDetail
include: {
  answers: { orderBy: { question_snapshot: "asc" } },
},
});
if (!submission) throw new ServiceError("checkin_submission_not_found", 404);
return submission;
```

**After:**
```ts
include: {
  client: {
    include: { user: { select: { username: true, email: true } } },
  },
  answers: true,
},
});
if (!submission) throw new ServiceError("checkin_submission_not_found", 404);
// Prisma cannot order by nested JSON (question_snapshot.order);
// Postgres sorts JSONB by keys (options before order), scrambling results.
// Sort in memory by snapshot order.
submission.answers.sort((a, b) => {
  const ordA = (a.question_snapshot as unknown as { order?: number })?.order ?? 0;
  const ordB = (b.question_snapshot as unknown as { order?: number })?.order ?? 0;
  return ordA - ordB;
});
return submission;
```
```ts
// getMySubmissionDetail
include: {
  answers: true,
},
});
if (!submission) throw new ServiceError("checkin_submission_not_found", 404);
// Prisma cannot order by nested JSON (question_snapshot.order) — sort in memory.
submission.answers.sort((a, b) => {
  const ordA = (a.question_snapshot as unknown as { order?: number })?.order ?? 0;
  const ordB = (b.question_snapshot as unknown as { order?: number })?.order ?? 0;
  return ordA - ordB;
});
return submission;
```

**Why:** In-memory sort by `snapshot.order` is deterministic and matches coach-defined `order`.

---

## 3. Medium — TypeError on malformed `answers` items (500 instead of 400)

**File:** `src/modules/checkin/checkin.validation.ts:179-190`

**Problem:**
`answers: [null]` or `["invalid"]` → `a.question_id` throws `TypeError: Cannot read properties of null`. Called outside try/catch in controller → unhandled 500.

**Before:**
```ts
for (let i = 0; i < body.answers.length; i++) {
  const a = body.answers[i];
  if (!a.question_id || typeof a.question_id !== "string" || !isValidUuid(a.question_id)) {
    errors.push(`${t("invalid_uuid")} at answers[${i}].question_id`);
  }
  if (a.answer_value === undefined || a.answer_value === null) {
    errors.push(`${t("checkin_answer_required")} at answers[${i}]`);
  }
}
```

**After:**
```ts
for (let i = 0; i < body.answers.length; i++) {
  const a = body.answers[i];
  if (!a || typeof a !== "object") {
    errors.push(`${t("invalid_request")} at answers[${i}]`);
    continue;
  }
  if (!a.question_id || typeof a.question_id !== "string" || !isValidUuid(a.question_id)) {
    errors.push(`${t("invalid_uuid")} at answers[${i}].question_id`);
  }
  if (a.answer_value === undefined || a.answer_value === null) {
    errors.push(`${t("checkin_answer_required")} at answers[${i}]`);
  }
}
```

**Why:** Non-objects become validation errors (400), no exception.

---

## 4. Medium — Blank optional answers rejected

**File:** `src/modules/checkin/checkin.service.ts:283-293`

**Problem:**
Optional question sent as `{ answer_value: "" }` → `val` is `""` not `undefined`, so `validateAnswerValue` runs: TEXT throws `checkin_text_answer_empty`, NUMBER `parseFloat("")=NaN`, RATING `parseInt("")=NaN`.

**Before:**
```ts
// Validate each answer value against its question type
for (const q of questions) {
  const val = answersMap.get(q.id);
  if (val === undefined) continue;
  this.validateAnswerValue(q as { id: string; type: string; options: string[] }, val);
}
```

**After:**
```ts
// Validate each answer value against its question type
// Blank optional answers are skipped and omitted from persisted answers.
for (const q of questions) {
  const val = answersMap.get(q.id);
  if (val === undefined) continue;
  if (!q.required && val.trim() === "") {
    answersMap.delete(q.id);
    continue;
  }
  this.validateAnswerValue(q as { id: string; type: string; options: string[] }, val);
}
```

**Why:** Blank optionals are treated as unanswered and excluded from `createMany`. Required blanks still hit `checkin_missing_required_answers` earlier.

---

## 5. Medium — Update permits choice type without options

**File:** `src/modules/checkin/checkin.validation.ts:107-122`

**Problem:**
Create requires `options.length >= 2` for `SINGLE_CHOICE`/`YES_NO`, but update only checked item shape. `{ type: "SINGLE_CHOICE" }` without options or `{ options: [] }` creates an unanswerable question (every answer fails `checkin_invalid_choice_answer`).

**Before:**
```ts
if (body.options !== undefined) {
  if (!Array.isArray(body.options) || body.options.some((o: unknown) => typeof o !== "string" || !o.trim())) {
    errors.push(t("checkin_options_invalid"));
  }
}
```

**After:**
```ts
// SINGLE_CHOICE / YES_NO require >= 2 options. On update, changing type to a
// choice type without supplying options would create an unanswerable question.
if (body.type === "SINGLE_CHOICE" || body.type === "YES_NO") {
  if (!Array.isArray(body.options) || body.options.length < 2) {
    errors.push(t("checkin_options_required"));
  } else if (body.options.some((o: unknown) => typeof o !== "string" || !o.trim())) {
    errors.push(t("checkin_options_invalid"));
  }
} else if (body.options !== undefined) {
  if (!Array.isArray(body.options) || body.options.some((o: unknown) => typeof o !== "string" || !o.trim())) {
    errors.push(t("checkin_options_invalid"));
  }
}
```

**Why:** Update now enforces same invariant as create when resulting type is a choice type.

---

## 6. Low — Inexact NUMBER / RATING parsing

**File:** `src/modules/checkin/checkin.service.ts:328-342`

**Problem:**
`parseFloat("75kg")→75`, `parseFloat("Infinity")→Infinity`, `parseInt("5.8")→5` all pass, but raw strings are stored.

**Before:**
```ts
case "NUMBER": {
  const n = parseFloat(val);
  if (isNaN(n) || n < 0) throw new ServiceError("checkin_invalid_number_answer", 400);
  break;
}
case "RATING": {
  const n = parseInt(val, 10);
  if (isNaN(n) || n < 1 || n > 10) throw new ServiceError("checkin_invalid_rating_answer", 400);
  break;
}
```

**After:**
```ts
case "NUMBER": {
  // Strict: non-negative plain number only. Rejects "75kg", "Infinity", "", "  ".
  if (!/^\d+(\.\d+)?$/.test(val.trim())) throw new ServiceError("checkin_invalid_number_answer", 400);
  break;
}
case "RATING": {
  // Strict: integer 1-10 only. Rejects "5.8", "5stars", "0", "11".
  if (!/^(?:[1-9]|10)$/.test(val.trim())) throw new ServiceError("checkin_invalid_rating_answer", 400);
  break;
}
```

**Why:** Full-string match prevents silent truncation; `Infinity`/units/decimals for rating rejected.

---

## 7. Low — Non-transactional coach signup

**File:** `src/modules/auth/auth.service.ts:60-111`

**Problem:**
`users.create` ran before the `coach_profiles` + `createDefaultCheckInQuestions` transaction, and `verification_codes.create` ran after. Seeding failure → orphaned user (cannot login as coach, cannot re-register same email).

**Before:**
```ts
const user = await this.prisma.users.create({ data: { username, email, password, role, provider: "email" } });
if (input.role === "client") {
  await this.prisma.client_profiles.create({ data: { user_id: user.id, ... } });
} else if (input.role === "coach") {
  await this.prisma.$transaction(async (tx) => {
    const coachProfile = await tx.coach_profiles.create({ data: { user_id: user.id, ... } });
    await createDefaultCheckInQuestions(tx, coachProfile.id);
  });
}
const code = this.generateCode();
await this.prisma.verification_codes.create({ data: { user_id: user.id, ... } });
await this.emailService.sendVerificationCode(user.email, code, lng).catch(() => {});
```

**After:**
```ts
const code = this.generateCode();
const codeHash = this.hashToken(code);

// All writes in one transaction: user + profile + defaults + verification code.
// Prevents orphaned user if coach profile/defaults seeding fails.
let createdUserEmail = email;
await this.prisma.$transaction(async (tx) => {
  const user = await tx.users.create({ data: { username, email, password, role, provider: "email" } });
  createdUserEmail = user.email;
  if (input.role === "client") {
    await tx.client_profiles.create({ data: { user_id: user.id, ... } });
  } else if (input.role === "coach") {
    const coachProfile = await tx.coach_profiles.create({ data: { user_id: user.id, ... } });
    await createDefaultCheckInQuestions(tx, coachProfile.id);
  }
  await tx.verification_codes.create({ data: { user_id: user.id, code_hash: codeHash, ... } });
});
await this.emailService.sendVerificationCode(createdUserEmail, code, lng).catch(() => {});
```

**Why:** All-or-nothing. Email send stays outside transaction (side effect, after commit).

---

## 8. Workspace hygiene

**Change — `.gitignore`:**
```diff
+tmp/
+reports/apidog-sync-report.md
```

**Before:** `tmp/*.json` (local test payloads: `create-assign.json`, `move-assign.json`, …) and generated `reports/apidog-sync-report.md` were untracked and at risk of commit.

**After:** Ignored. Scratch migration helpers remain untracked and must NOT be committed:
- `scripts/apply-migration.ts`
- `scripts/add-checkin-migration-record.ts`
- `scripts/add-cascade-record.ts`
- `scripts/fix-cascade.ts`
- `scripts/check-tables.ts`

They insert dummy `checksum='dummy'` rows into `_prisma_migrations` and will break `prisma migrate deploy` on other envs. Delete after migrations are clean.

---

## Verification

- `npx tsc --noEmit` → exit 0
- `npm test -- tests/unit/checkin.test.ts tests/unit/checkin-questions-gate.test.ts` → 31 pass
- `npm test` → 7 suites / 120 tests pass
