# Frontend Guide — Coach Client Profile, Questions & Goals

Date: 2026-09-15. Backend only; no mobile changes needed except handling below.

## 1. `GET /api/v1/coach/clients/:clientProfileId`

`:id` = **`client_profiles.id`** (the `client.id` inside `GET /coach/clients` items, NOT the top-level assignment `id`).
Coach must be assigned to the client, otherwise `404 { error }`. Auth: coach token only.

### Before
```json
{
  "client": { "id": "...", "goal": "muscle_building", "...": "..." },
  "nutrition_plan": { "id": "...", "title": "..." } | null,
  "workout_plan": null,
  "nutrition_streak": { "current": 0, "last_date": null },
  "workout_streak": { "current": 0, "last_date": null },
  "questions_answers": []
}
```

### After
```json
{
  "client": { "id": "...", "goal": "muscle building", "assigned_at": "..." },
  "nutrition_plan": { "id": "...", "title": "...", "description": "...", "is_active": true, "created_at": "..." } | null,
  "workout_plan": { "id": "...", "title": "...", "description": "...", "is_active": true, "created_at": "...", "start_date": "...", "cycle_days": 7 } | null,
  "questions_answers": [
    { "id": "...", "question_id": "...", "answer": "0", "answer_text": "Lose weight", "question": "What are your primary fitness goals?", "question_type": "choice", "created_at": "..." }
  ],
  "total_answers": 8,
  "total_questions": 12
}
```

### What changed
- **REMOVED:** `nutrition_streak`, `workout_streak` (deleted entirely — do not read them).
- **ADDED:** real `workout_plan` (was always `null`). `null` now means "no active plan". Shape has 2 extra fields vs nutrition: `start_date`, `cycle_days`.
- **ADDED:** `total_answers` + `total_questions` (per requested language).
- `goal` now returns **spaces, not underscores**: `muscle_building` → `muscle building`, `not_set` → `not set`. Applies to every goal field (detail, list, requests, profile). Compare/display using spaced values.

### Completeness check (questions)
```dart
final complete = (json['total_answers'] as int) >= (json['total_questions'] as int);
```
- `total_answers` = distinct question groups answered (answering both en+ar versions of one question counts **once**).
- `total_questions` = questions in the requested language (`Accept-Language: en|ar`).
- NOTE: `questions_answers.length` can exceed `total_answers` in the bilingual double-answer edge — always use the totals for progress, not array length.
- Empty onboarding → `questions_answers: []`, `total_answers: 0`.

## 2. `GET /api/v1/client/questions` (public)

```json
// Before: { "questions": [...] }
// After:
{ "questions": [...], "total": 12 }
```
`total = questions.length` (per `Accept-Language`). No other change.

## 3. `GET /api/v1/client/answers` (client auth)

```json
// Before: { "answers": [...] }
// After:
{ "answers": [...], "total": 8, "total_questions": 12 }
```
- `total` = distinct groups answered; `total_questions` = per-language total.
- Complete when `total >= total_questions`. Same bilingual note as above.

## 4. Goal formatting — all endpoints

Every `goal` in responses now has underscores replaced with single spaces:
`muscle_building` → `muscle building`, `lose_weight` → `lose weight`.
Affected: coach client detail, `GET /coach/clients` list items, `GET /coach/requests` items, `GET /profile` + profile update responses. Stored values unchanged — only the response is formatted, so handle spaced strings (and legacy underscore strings defensively, e.g. `.replaceAll('_', ' ')` before compare).

## 5. Breaking changes checklist

| Change | Action |
|---|---|
| `nutrition_streak` / `workout_streak` gone | Remove reads; 404/200 codes unchanged |
| `workout_plan: null` → object | Handle object + `null` (no plan) |
| `GET /client/answers` shape `{answers,total,total_questions}` | Update model (was `{answers}`) |
| `GET /client/questions` adds `total` | Optional use; additive only |
| Coach detail adds `total_answers/total_questions` | Use for progress bar |
| `goal` spaced | Update equality checks, dropdown values, search filters |

## 6. Quick test matrix

1. Assigned coach → `GET /coach/clients/<client_profiles.id>` → 200 with plans + totals.
2. Unassigned coach → same call → `404 client_not_assigned`, no data leaked.
3. Client with no answers → `questions_answers: []`, `total_answers: 0`, `total_questions > 0`.
4. `Accept-Language: ar` → questions/totals in Arabic, counts per Arabic list.
