# Coach Achievements (PDF + Title) — Flutter Guide

Backend: `Athletica-bakend` Express + Prisma + Cloudinary. Single contract for building coach PDF achievements in Flutter.
Base URL: `https://api.athletica.app/api/v1` (local: `http://localhost:3000/api/v1`).

---

## 1. Concept & roles

| Role | What they do |
|------|--------------|
| **Coach** | Uploads PDF certificate + title (`POST`), lists own achievements (`GET`), deletes own (`DELETE`). Max **50** PDFs, each ≤**10 MB**, `application/pdf` only. Stored in Cloudinary `athletica/achievements` (raw), `secure_url` is public PDF URL. |
| **Client** | **Read-only** lists assigned coach's achievements (`GET /client/coach/achievements`) via `coach_clients` link. No upload/delete. Unassigned → `404 no_coach_assigned`. |

No update endpoint — replace = delete + re-upload. List caps at **100** newest-first.

```
Coach POST /coach/achievements {title,pdf} → 201 {id,title,file_url}
       │
       ├─► Coach GET /coach/achievements → {achievements:[...]}  (own only)
       ├─► Coach DELETE /coach/achievements/:id → 200 (Cloudinary destroy best-effort)
       │
       └─► Client GET /client/coach/achievements → {achievements:[...]} (assigned coach only)
```

IDs: `coach_achievements.id` (UUID), `coach_profiles.id` (internal), `coach_clients.id` (assignment row). Never send `coach_id` — server resolves it from JWT `sub` → `coach_profiles`.

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
  dio.options.headers['Accept-Language'] = lang; // 'en' | 'ar' — backend translates `error`
}
```

- Auth: `Authorization: Bearer <jwt>` on **every** call. 401 = missing/expired, 403 = wrong role.
- Language: `Accept-Language: en|ar`. Errors are `{error: <translated>, details?}` — branch on **HTTP status + key**, never on text.
- Only upload uses `multipart/form-data` (Dio sets it via `FormData`); lists/delete are JSON.

---

## 3. Data model

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

```dart
class CoachAchievement {
  final String id, coachId, title, fileUrl;
  final String? fileName;
  final int? fileSize;
  final String mimeType;
  final DateTime createdAt;

  CoachAchievement({
    required this.id, required this.coachId, required this.title,
    required this.fileUrl, this.fileName, this.fileSize,
    required this.mimeType, required this.createdAt,
  });

  factory CoachAchievement.fromJson(Map<String,dynamic> j) => CoachAchievement(
    id: j['id'] as String,
    coachId: j['coach_id'] as String,
    title: j['title'] as String,
    fileUrl: j['file_url'] as String,
    fileName: j['file_name'] as String?,
    fileSize: j['file_size'] as int?,
    mimeType: j['mime_type'] as String? ?? 'application/pdf',
    createdAt: DateTime.parse(j['created_at'] as String),
  );
}
```

- `file_url` is a **public raw Cloudinary URL** — open directly with `url_launcher` or `flutter_pdfview` / `syncfusion_flutter_pdfviewer`. No signed URL needed.
- `title` is user-provided, `trim()` 1..200 chars; display as card title. `file_name`/`file_size` are display helpers.

---

## 4. Coach API

| # | Method & path | Body | Success | Errors |
|---|---------------|------|---------|--------|
| C1 | `POST /coach/achievements` | multipart `title` (text) + `pdf` (file) | `201 {CoachAchievement}` | 400 validation, 413 too large, 403 role, 404 profile |
| C2 | `GET /coach/achievements` | — | `200 {achievements:[]}` newest-first, max 100 | 401/403/404 |
| C3 | `DELETE /coach/achievements/:id` | — | `200 {message}` | 400 uuid, 403 role, 404 not found/foreign |

### C1 Upload — implement exactly

Backend: `multer.memoryStorage`, `limits: {fileSize: 10*1024*1024, files:1}`, `fileFilter: mimetype === application/pdf` else `achievement_invalid_file_type` 400. Service checks `file.size>0` else `pdf_required`, `title` typeof string + trim 1..200, quota `count < 50` else `achievement_limit_reached` 400. Orphan Cloudinary cleanup on DB error.

```dart
import 'dart:io';
import 'package:dio/dio.dart';
import 'package:file_picker/file_picker.dart';
import 'package:http_parser/http_parser.dart';

Future<CoachAchievement> uploadAchievement({
  required String title,
  required PlatformFile pickedPdf, // from file_picker
}) async {
  // Client-side mirror to avoid round-trip:
  final t = title.trim();
  if (t.isEmpty) throw const FormatException('title_required');
  if (t.length > 200) throw const FormatException('title_too_long');
  if (pickedPdf.size == 0) throw const FormatException('pdf_required');
  if (pickedPdf.size > 10 * 1024 * 1024) throw const FormatException('achievement_file_too_large');
  // file_picker gives extension; also check mime if available
  if (pickedPdf.extension?.toLowerCase() != 'pdf') throw const FormatException('achievement_invalid_file_type');

  final form = FormData();
  form.fields.add(MapEntry('title', t));
  form.files.add(MapEntry(
    'pdf', // FIELD NAME MUST BE EXACTLY "pdf"
    MultipartFile.fromBytes(
      pickedPdf.bytes ?? await File(pickedPdf.path!).readAsBytes(),
      filename: pickedPdf.name, // -> file_name
      contentType: MediaType('application', 'pdf'),
    ),
  ));

  final res = await dio.post('/coach/achievements', data: form);
  return CoachAchievement.fromJson(res.data as Map<String,dynamic>);
}

// Picker helper
Future<PlatformFile?> pickPdf() async {
  final result = await FilePicker.platform.pickFiles(
    type: FileType.custom,
    allowedExtensions: ['pdf'],
    withData: true, // bytes for Dio
  );
  return result?.files.first;
}
```

Constraints to enforce **before** `dio.post`:
- `title` required, `typeof string`, trim non-empty, ≤200. Show inline error.
- `pdf` required, extension `pdf`, mime `application/pdf`, size `1 .. 10MB`. Reject empty picker result.
- Disable button while `isUploading` (prevents double quota hit). `MAX = 50` — if `C2.length >= 50` disable upload UI and show `achievement_limit_reached`.

### C2 List mine

```dart
Future<List<CoachAchievement>> listMyAchievements() async {
  final res = await dio.get('/coach/achievements');
  final list = res.data['achievements'] as List;
  return list.map((e) => CoachAchievement.fromJson(e)).toList();
}
```

Empty → `[]` (show "No certificates yet" + upload CTA).

### C3 Delete

```dart
Future<void> deleteAchievement(String id) async {
  await dio.delete('/coach/achievements/$id');
}
```

Id must be UUID. Server returns `404 achievement_not_found` for missing **or foreign** id (no existence oracle). After success, remove from local list without refetch or invalidate provider.

**Coach screens:**
1. **My Certificates** (`C2` on init, pull-refresh): `ListView` cards — title, date `created_at`, `file_name`/`file_size` subtitle, trailing actions: `Open PDF` (`url_launcher` on `file_url`), `Delete` (confirm dialog). FAB → upload sheet.
2. **Upload sheet**: title `TextField` (counter 200), `Pick PDF` button, filename+size preview, `Upload` → `C1` → on `201` insert at top (server sorts desc) or refetch `C2`.

---

## 5. Client API (read-only)

| # | Method & path | Success | Errors |
|---|---------------|---------|--------|
| L1 | `GET /client/coach/achievements` | `200 {achievements:[]}` newest-first, max 100 | 401/403 not a client, 404 `no_coach_assigned`/`client_profile_not_found` |

```dart
Future<List<CoachAchievement>> listCoachAchievementsForClient() async {
  final res = await dio.get('/client/coach/achievements');
  final list = res.data['achievements'] as List;
  return list.map((e) => CoachAchievement.fromJson(e)).toList();
}
```

Flow:
1. On client home/profile, call `L1` after confirming assignment (e.g. `GET /client/coach` already succeeded). If client has no coach, show empty state "No coach assigned" (do not call `L1`).
2. Render same card UI but **no delete/upload**. Tapping `Open PDF` launches `file_url`.
3. If `404 no_coach_assigned`, show "Assign to a coach to see certificates" CTA.

---

## 6. Validation mirror (avoid round-trips)

Before upload:

| Field | Client check | Server key |
|-------|--------------|------------|
| `title` missing/non-string/empty after trim | `trim().isEmpty` | `title_required` 400 |
| `title` >200 | `trim().length >200` | `title_too_long` 400 |
| `pdf` missing | picker `null` | `pdf_required` 400 |
| `pdf` size 0 | `size ==0` | `pdf_required` 400 |
| `pdf` >10MB | `size >10*1024*1024` | `achievement_file_too_large` 413 |
| `pdf` not PDF | `extension != pdf` or mime `!= application/pdf` | `achievement_invalid_file_type` 400 |
| Quota ≥50 | `list.length >=50` | `achievement_limit_reached` 400 |

After upload, branch on **status + key** (never on translated `error` string):

| Status | Key | UI |
|--------|-----|----|
| 400 | `title_required/title_too_long/pdf_required/achievement_invalid_file_type/achievement_limit_reached` | Inline field error or snackbar |
| 413 | `achievement_file_too_large` | "Max 10MB" snackbar |
| 401 | `auth_required/token_expired` | Re-login |
| 403 | `insufficient_permissions` (client on coach route) | Role bug — check JWT role |
| 404 | `coach_profile_not_found` (coach not setup) / `client_profile_not_found` / `no_coach_assigned` / `achievement_not_found` / `invalid_uuid` | Empty/error state |

---

## 7. Suggested Flutter structure

```
lib/features/achievements/
  data/achievements_api.dart        // C1-C3, L1 with Dio + FormData
  data/achievement_model.dart       // CoachAchievement
  data/achievements_repository.dart // quota check, file validation, orphan cleanup note
  coach/achievements_page.dart      // C2 list + delete
  coach/upload_achievement_sheet.dart // title field + FilePicker + progress
  client/coach_achievements_page.dart // L1 read-only list
  widgets/achievement_card.dart     // title, file_name, size, date, open/delete
  widgets/pdf_preview.dart          // url_launcher / pdf viewer wrapper
```

Providers (Riverpod):

```dart
final achievementsProvider = FutureProvider<List<CoachAchievement>>((ref) => AchievementsApi(dio).listMyAchievements());
final clientCoachAchievementsProvider = FutureProvider<List<CoachAchievement>>((ref) => AchievementsApi(dio).listCoachAchievementsForClient());
```

Invalidate `achievementsProvider` after `C1`/`C3`; no need to invalidate on client side (read-only).

---

## 8. Polling & caching

- No realtime push for achievements. Poll `C2`/`L1` on page focus and after upload/delete. Responses capped at 100 rows → no pagination handling in v1.
- `file_url` is stable `secure_url`; cache card list but not PDF bytes. For PDF viewer, fetch URL on demand.

---

## 9. QA checklist

- [ ] Coach upload without title → `400 title_required` inline error (not 500).
- [ ] Title >200 chars → `400 title_too_long` blocked client-side.
- [ ] Non-PDF (png/jpg) → `400 achievement_invalid_file_type` rejected client-side.
- [ ] 0-byte PDF → `400 pdf_required`.
- [ ] 10MB+ PDF → `413 achievement_file_too_large` (test with 11MB dummy file).
- [ ] 50 PDFs → 51st upload blocked with `achievement_limit_reached` (button disabled).
- [ ] List mine shows only own rows; second coach's delete on foreign id → `404`.
- [ ] Client unassigned → `404 no_coach_assigned` → empty state with CTA.
- [ ] Assigned client sees coach's newest-first order after pull-refresh.
- [ ] `file_url` opens in external viewer / in-app PDF view.
- [ ] Arabic RTL shows translated errors (`Accept-Language: ar`) when `dio` header set.
- [ ] Double-tap upload sends once (`isUploading` guard).

---

## 10. Quick reference (copy-paste paths)

```
POST   /coach/achievements               // coach, multipart: title + pdf
GET    /coach/achievements               // coach, list mine
DELETE /coach/achievements/:id           // coach, delete own
GET    /client/coach/achievements        // client, list assigned coach
```

Base `dio.options.baseUrl = https://api.athletica.app/api/v1`. All need `Authorization: Bearer <jwt>`. OpenAPI import: `api/apidog-coach-achievements.json` (Apidog > Import > OpenAPI). Full spec: `docs/COACH_ACHIEVEMENTS_APIDOG.md` + `specs/007-coach-achievements/`.
