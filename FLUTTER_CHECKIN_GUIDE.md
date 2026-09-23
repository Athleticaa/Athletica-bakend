# Check-In Feature — Flutter Guide (Coach + Client)

Backend: `Athletica-bakend` Express + Prisma. This doc is the single contract for building the Check-In feature in Flutter.
Base path examples assume `baseUrl = https://api.athletica.app/api/v1` — replace with dev/staging URL.

---

## 1. Concept & roles

| Role | What they do |
|------|--------------|
| Coach | Owns one check-in form (list of questions). Edits form, assigns check-in to a client, reviews submissions. New coaches are seeded with 24 default questions. |
| Client | Linked to one coach via `coach_clients`. When coach assigns, client sees a pending check-in, fills the form, submits once. Assignment is consumed on submit (one-shot). |

Lifecycle:

```
Coach creates/edits form ──► Coach POST /coach/checkin/assign {coach_client_id}
                                    │
                                    ▼
Client GET /client/checkin/hasassign → {has_pending:true}
Client GET /client/checkin/questions → [questions...] (empty [] if no pending)
Client POST /client/checkin/submit (multipart) → {submission_id, submitted_at}
                                    │
                                    ▼ (assignment deleted server-side)
Client GET /client/checkin/hasassign → {has_pending:false}
Coach GET /coach/checkin/clients/:id/submissions → history
```

Key rule: **questions list is only visible to the client while a pending assignment exists.** Otherwise `GET questions` returns `200 []`. Always check `hasassign` first for banners/badges.

IDs you must not confuse:

- `user.id` (auth) ≠ `client_profiles.id` ≠ `coach_clients.id`
- `POST /coach/checkin/assign` takes `coach_client_id` = `coach_clients.id` (the coach↔client link row), NOT `client_profiles.id`. Get it from the coach-assignment module client list.
- `question.id`, `submission.id` are UUIDs.

---

## 2. Base config (Dio)

```dart
final dio = Dio(BaseOptions(
  baseUrl: 'https://api.athletica.app/api/v1',
  connectTimeout: const Duration(seconds: 15),
  receiveTimeout: const Duration(seconds: 30),
  headers: {'Accept': 'application/json'},
));

Future<void> attachAuth(String accessToken, String lang) async {
  dio.options.headers['Authorization'] = 'Bearer $accessToken';
  dio.options.headers['Accept-Language'] = lang; // 'en' | 'ar', backend translates `error`
}
```

- Auth: `Authorization: Bearer <accessToken>` on every call. `authenticate` → 401 if missing/expired, `authorize('coach'|'client')` → 403 on wrong role.
- Language: send `Accept-Language: en|ar`. All errors are `{ error: <translated string>, details?: [...] }`. For logic branching, also match HTTP status (see §7) — do not string-match translated text.
- JSON calls: `Content-Type: application/json`. Submit call is the only `multipart/form-data` (Dio sets it automatically with `FormData`).

---

## 3. Data models

### 3.1 `CheckinQuestion`

```json
{
  "id": "uuid",
  "coach_id": "uuid",
  "question": "Current Weight (kg)",
  "type": "NUMBER",
  "options": [],
  "required": true,
  "order": 1,
  "created_at": "2026-09-22T...",
  "updated_at": "2026-09-22T..."
}
```

```dart
enum CheckinQuestionType { NUMBER, TEXT, SINGLE_CHOICE, YES_NO, RATING, IMAGE }

class CheckinQuestion {
  final String id, coachId, question;
  final CheckinQuestionType type;
  final List<String> options;
  final bool required;
  final int order;
  CheckinQuestion({required this.id, required this.coachId, required this.question,
    required this.type, required this.options, required this.required, required this.order});
  factory CheckinQuestion.fromJson(Map<String,dynamic> j) => CheckinQuestion(
    id: j['id'], coachId: j['coach_id'], question: j['question'],
    type: CheckinQuestionType.values.byName(j['type']),
    options: List<String>.from(j['options'] ?? []),
    required: j['required'] ?? true, order: j['order'] ?? 0);
}
```

Question types → UI widget:

| Type | Backend rule | Flutter widget |
|------|--------------|----------------|
| `NUMBER` | Strict `^\d+(\.\d+)?$` after trim, ≥0. Rejects `75kg`, `Infinity`, empty | `TextField` numeric + decimal, inputFormatter mirror regex |
| `TEXT` | Non-empty after trim if answered; blank optional omitted | `TextField` multiline |
| `RATING` | Strict `^(1\|2\|...\|10)$` — integer 1-10 only. Rejects `5.8`, `5stars` | Slider/selector 1-10 or star row |
| `SINGLE_CHOICE` | Value must equal one of `options` exactly | Radio list / dropdown |
| `YES_NO` | Value must equal one of `options` (defaults `["Yes","No"]`) | Yes/No segmented buttons |
| `IMAGE` | File upload, not JSON. jpeg/png/webp, ≤5MB, ≤10 files total | Image picker + preview + retake |

Constraints: `question` 1-500 chars. `SINGLE_CHOICE`/`YES_NO` need ≥2 non-empty options. `order` positive int, unique ordering managed by reorder endpoint.

### 3.2 Submissions

List item (both roles):
```json
{ "id": "uuid", "submitted_at": "...", "coach_id": "uuid", "coach_client_id": "uuid", "client_id": "uuid" }
```
Detail `GET .../submissions/:id → { submission: { id, submitted_at, ..., client?: {user:{username,email}}, answers: [...] } }`:

```json
{ "id": "answer-uuid", "submission_id": "...", "question_id": "uuid|null",
  "answer_value": "76.4 | Yes | https://res.cloudinary.com/.../front.jpg",
  "question_snapshot": { "question": "...", "type": "NUMBER", "options": [], "required": true, "order": 1 } }
```

Notes: `answers` arrive **sorted by `question_snapshot.order`** (fixed server-side). Render in array order — do not re-sort. `answer_value` for IMAGE is a Cloudinary HTTPS URL — display with `CachedNetworkImage`. `question_id` may be null if question deleted after submit — fall back to snapshot text.

### 3.3 Default form (new coach seed, 24 questions)

12× `NUMBER` required orders 1-12 (Weight, Neck, Shoulders, Chest, Arms, Waist, Hips, Thighs, Calves) + 3× `IMAGE` optional orders 13-15 (Front/Side/Back) + 9× reflection orders 16-24 (RATING 16/21, YES_NO 17 `["Yes","No"]`, TEXT 18/20/23/24, SINGLE_CHOICE 19 `["Yes","Partially","No"]`, 22 `["Yes","Needs Adjustment"]`). Use this to design the client form scroll — expect ~24 rows.

---

## 4. Coach API (prefix `/coach/checkin`)

| # | Method & path | Body | Success | Errors |
|---|---------------|------|---------|--------|
| C1 | `GET /coach/checkin/questions` | — | `200 {questions:[...]}` ordered | 401/403/404 coach_profile |
| C2 | `POST /coach/checkin/questions` | `{question*, type*, options?, required?, order?}` | `201 {question}` | 400 validation |
| C3 | `PATCH /coach/checkin/questions/reorder` | `{question_ids:[uuid...]*}` full list, no dupes | `200 {questions}` reordered | 400 mismatch/dupe |
| C4 | `PATCH /coach/checkin/questions/:id` | `{question?, type?, options?, required?, order?}` ≥1 field | `200 {question}` | 400 validation/uuid, 404 not found |
| C5 | `DELETE /coach/checkin/questions/:id` | — | `200 {message}` | 400 cannot_delete_last, 404 |
| C6 | `POST /coach/checkin/assign` | `{coach_client_id: uuid*}` | `201 {message, assignment}` upsert pending | 400 uuid, 404 not assigned |
| C7 | `GET /coach/checkin/clients/:coachClientId/submissions` | — | `200 {submissions:[{id,submitted_at}]}` desc | 400 uuid, 404 not assigned |
| C8 | `GET /coach/checkin/clients/:coachClientId/submissions/:submissionId` | — | `200 {submission:{...,answers:[...]}}` | 400/404 |

Bodies:

```dart
// C2 create
{'question':'Sleep hours?','type':'NUMBER','required':true}
// choice:
{'question':'Goal met?','type':'SINGLE_CHOICE','options':['Yes','Partially','No'],'required':true}
// C3 reorder — must contain EXACTLY all owned IDs in new order:
{'question_ids': orderedIds}
// C4 update — changing type to choice REQUIRES options:
{'type':'SINGLE_CHOICE','options':['A','B']}
// C6 assign:
{'coach_client_id': coachClientId}
```

Coach flow (screens):

1. **Form builder** (`C1` on init): list sorted by `order`. Actions: add (`C2`), edit (`C4`), delete (`C5`, confirm; disable delete when `length==1`), reorder via `ReorderableListView` → `C3` with full ID list. Changing type to choice without ≥2 options → 400 — validate in UI before send.
2. **Clients → Assign**: from existing clients list (coach-assignment module) get `coach_clients.id` → `C6`. Upsert semantics: re-assign just refreshes `pending`. Show toast `checkin_assigned`.
3. **Submissions** (`C7` per client): list desc. Tap → `C8` detail: header client name/email + date, then answers in order; IMAGE → image grid, RATING → badge, choice → chip.

---

## 5. Client API (prefix `/client/checkin`)

| # | Method & path | Body | Success | Errors |
|---|---------------|------|---------|--------|
| L1 | `GET /client/checkin/hasassign` | — | `200 {has_pending:bool}` | 401/403/404 no_coach |
| L2 | `GET /client/checkin/questions` | — | `200 {questions:[...]}` or `200 {questions:[]}` if no pending | same |
| L3 | `POST /client/checkin/submit` | multipart (see §6) | `201 {submission_id, submitted_at}` | 400/403/404 (see §7) |
| L4 | `GET /client/checkin/submissions` | — | `200 {submissions}` desc | — |
| L5 | `GET /client/checkin/submissions/:submissionId` | — | `200 {submission}` | 400/404 |

Client flow (screens):

1. **Home/banner**: on app start + pull-refresh call `L1`. If `has_pending` show “New check-in from your coach” CTA → form screen. Else show history (`L4`).
2. **Form** (`L2`): if `[]` show empty state “No pending check-in”. Else build dynamic form sorted by `order`. Mark required with `*`. Validate locally first (§7), then `L3`. On `201` navigate to success → refresh `L1` (now false) + `L4`.
3. **History/detail** (`L4`/`L5`): list + detail same rendering as coach.

---

## 6. Submit (multipart) — implement exactly

Backend (`upload.any()`, memory, 5MB/file, 10 files, jpeg/png/webp only):

- Text field **`answers`**: JSON **string** of array `[{question_id, answer_value}]`. Only non-IMAGE answers go here. IMAGE answers go as files, NOT in this array.
- Files: **one part per IMAGE question, field name = `question_id` (UUID)**, filename anything, content-type jpeg/png/webp.
- Optional blank TEXT/NUMBER/RATING: **omit** from `answers` entirely (server deletes blanks and skips). Do not send `""`.
- Required IMAGE with no file → `400 checkin_missing_required_answers {missing:[ids]}`.
- Empty `answers: "[]"` with only files is valid (do not block file-only submit client-side).

```dart
import 'package:dio/dio.dart';
import 'package:image_picker/image_picker.dart';

Future<Map<String,dynamic>> submitCheckin({
  required List<Map<String,String>> textAnswers, // [{question_id, answer_value}]
  required Map<String, XFile> imageByQuestionId, // questionId -> picked file
}) async {
  final form = FormData();
  form.fields.add(MapEntry('answers', jsonEncode(textAnswers)));
  for (final e in imageByQuestionId.entries) {
    final bytes = await e.value.readAsBytes();
    form.files.add(MapEntry(
      e.key, // FIELD NAME MUST BE THE QUESTION UUID
      MultipartFile.fromBytes(bytes, filename: '${e.key}.jpg',
        contentType: DioMediaType('image','jpeg')),
    ));
  }
  final res = await dio.post('/client/checkin/submit', data: form);
  return res.data; // {submission_id, submitted_at}
}
```

Picker rules: `image_picker` → `XFile`, check `length ≤ 5*1024*1024`, mime jpeg/png/webp (compress to jpg if needed). Max 10 files. Show per-question thumbnail + remove. Disable double-tap submit (server consumes assignment in transaction but double-submit can race — guard with `isSubmitting` flag).

Example `textAnswers`:
```json
[{"question_id":"uuid-1","answer_value":"76.4"},
 {"question_id":"uuid-16","answer_value":"8"},
 {"question_id":"uuid-17","answer_value":"Yes"}]
```

---

## 7. Validation (mirror server to avoid round-trips)

Client-side before `L3`:

- Required: every `required==true` must have text entry or picked file. Else highlight + block.
- `NUMBER`: `/^\d+(\.\d+)?$/` on trim. Reject `75kg`, `-5`, `Infinity`, empty.
- `RATING`: `/^(10|[1-9])$/` on trim. Integer 1-10 only.
- `SINGLE_CHOICE`/`YES_NO`: value `==` one of `options` (exact, case-sensitive).
- `TEXT`: if required, trim non-empty; if optional + blank → omit.
- `question` create/edit: 1-500 chars; choice needs ≥2 non-empty options.

Server error map (status → UI):

| Status | `error` key | Meaning → UI |
|--------|-------------|--------------|
| 400 | `validation_failed` + `details[]` | Show details list |
| 400 | `checkin_answers_invalid_json` | Bug — answers not JSON string |
| 400 | `checkin_missing_required_answers` + `details.missing=[ids]` | Scroll to those questions |
| 400 | `checkin_invalid_question_id` | Stale form — refetch `L2` |
| 400 | `checkin_invalid_number/rating/choice/text_empty` | Field error |
| 400 | `invalid_upload` / `invalid_file_type` / `file_too_large` (413) | Wrong mime or >5MB |
| 403 | `checkin_no_pending_assignment` | Assignment already consumed — refetch `L1`, go history |
| 404 | `no_coach_assigned`, `client_not_assigned`, `checkin_submission_not_found`, `checkin_question_not_found` | Empty states |
| 400 | `checkin_cannot_delete_last_question`, `checkin_reorder_ids_mismatch` | Coach guards |

---

## 8. Suggested Flutter structure

```
lib/features/checkin/
  data/checkin_api.dart          // C1-C8, L1-L5 with Dio
  data/checkin_models.dart       // §3
  data/checkin_repository.dart   // caching + multipart builder
  coach/checkin_form_page.dart   // list + add/edit/delete/reorder
  coach/question_editor_sheet.dart
  coach/assign_checkin_button.dart
  coach/client_submissions_page.dart
  coach/submission_detail_page.dart // shared with client
  client/pending_banner.dart     // L1
  client/checkin_form_page.dart  // dynamic by type + image picker
  client/history_page.dart
  widgets/number_field.dart rating_input.dart choice_group.dart image_answer_tile.dart
```

Providers (Riverpod): `checkinQuestionsProvider`, `hasPendingProvider`, `submissionsProvider`, `submissionDetailProvider`. Invalidate `hasPending` + history after `L3`.

Shared `SubmissionDetailView(submission)` for both roles — only header differs (coach sees client user, client sees date).

---

## 9. QA checklist

- [ ] Coach with 1 question cannot delete (button disabled + server 400).
- [ ] Reorder persists after reload (`C1` order matches).
- [ ] Assign → client banner appears within refresh; submit → banner disappears.
- [ ] File-only + text-only + mixed submits all `201`.
- [ ] 5MB+ file → 413 friendly message; wrong mime → 400.
- [ ] `75kg`, `5.8` rating, `Infinity` blocked client-side.
- [ ] Optional blank TEXT omitted, not sent as `""`.
- [ ] Double-tap submit sends once.
- [ ] Offline: queue message, do not lose picked images.
- [ ] Arabic RTL renders translated errors (switch `Accept-Language`).

---

## 10. Quick reference (copy-paste paths)

```
GET    /coach/checkin/questions
POST   /coach/checkin/questions
PATCH  /coach/checkin/questions/reorder
PATCH  /coach/checkin/questions/:id
DELETE /coach/checkin/questions/:id
POST   /coach/checkin/assign
GET    /coach/checkin/clients/:coachClientId/submissions
GET    /coach/checkin/clients/:coachClientId/submissions/:submissionId
GET    /client/checkin/hasassign          (note spelling, no 'd')
GET    /client/checkin/questions
POST   /client/checkin/submit             (multipart)
GET    /client/checkin/submissions
GET    /client/checkin/submissions/:submissionId
```

Full JSON schemas: `openapi.json` (checkin tags). Human flow + errors: this file.
