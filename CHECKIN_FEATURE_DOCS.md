# Athletica Check-In Feature Documentation

---

## 1. Feature Overview

The **Check-In Feature** allows coaches to configure customized monthly check-in forms, assign them to clients, and enables clients to submit check-ins containing measurements, reflection answers, and progress photos.

### Key Business Rules

1. **Coach Question Ownership**: Each coach manages their own distinct set of check-in questions.
2. **Default Question Seeding**: When a coach registers, **24 default questions** are created automatically (12 body measurements, 3 progress photos, and 9 reflection questions).
3. **At-Least-One Rule**: A coach cannot delete all questions. The form must always contain at least **one** question. Attempting to delete the final question returns HTTP 400.
4. **Assignment Gate**: A client can only submit a check-in if they have an active **pending assignment** from their coach. The assignment is consumed (deleted) upon successful submission. Coaches address clients by their `coach_clients` relationship id (`coach_client_id`), consistent with the workout and nutrition modules. The client's questions list is likewise gated: `GET /client/checkin/questions` returns the form only while an assignment is pending, otherwise `200 { "questions": [] }`.
5. **Client Submissions & Required Answers**:
   - All `required: true` questions must have a non-empty, valid answer before submission is accepted.
   - The backend validates all rules regardless of frontend validation.
6. **Immutable Historical Submissions**:
   - Submissions are permanently saved. A new submission creates a new record and does not overwrite past records.
   - Every answer contains a `question_snapshot` (saving the question text, type, order, and options at the moment of submission).
   - If a coach edits or deletes a question later, previous client submissions remain viewable (`ON DELETE SET NULL` on the question foreign key).
7. **Progress Photos (optional)**:
   - Handled via Cloudinary through `multipart/form-data`.
   - Only JPEG, PNG, and WEBP formats allowed (max 5 MB per file).
   - The returned secure URL is stored as the answer value for `IMAGE` questions.
   - Default progress photo questions (Front, Side, Back) are **optional** (`required: false`). Custom coach IMAGE questions may be required or optional.

---

## 2. Data Models

### Prisma Models (`prisma/schema.prisma`)

#### `checkin_questions`

| Field | Type | Description |
|---|---|---|
| `id` | String @Id | UUID |
| `coach_id` | String | Foreign key to `coach_profiles` (Cascade on delete) |
| `question` | String @VarChar(500) | The question text |
| `type` | `checkin_question_type` | Enum: NUMBER, TEXT, SINGLE_CHOICE, YES_NO, RATING, IMAGE |
| `options` | String[] | Predefined options (for SINGLE_CHOICE, YES_NO) |
| `required` | Boolean @Default(true) | Whether the answer is required |
| `order` | Int | Sort order |
| `created_at` | DateTime | Auto-created |
| `updated_at` | DateTime | Auto-updated |

#### `checkin_submissions`

| Field | Type | Description |
|---|---|---|
| `id` | String @Id | UUID |
| `coach_id` | String | Foreign key to `coach_profiles` (Cascade on delete) |
| `client_id` | String | Foreign key to `client_profiles` (Cascade on delete) |
| `coach_client_id` | String? | Foreign key to `coach_clients` (SetNull on delete); NULL for rows created before the backfill |
| `submitted_at` | DateTime | Auto-created |

#### `checkin_answers`

| Field | Type | Description |
|---|---|---|
| `id` | String @Id | UUID |
| `submission_id` | String | Foreign key to `checkin_submissions` (Cascade on delete) |
| `question_id` | String? | Foreign key to `checkin_questions` (SetNull on delete) |
| `answer_value` | String @Text | The answer value |
| `question_snapshot` | Json | Snapshot of question text, type, options, required, order |

#### `checkin_assignments`

| Field | Type | Description |
|---|---|---|
| `id` | String @Id | UUID |
| `coach_id` | String | Foreign key to `coach_profiles` (Cascade on delete) |
| `client_id` | String | Foreign key to `client_profiles` (Cascade on delete) |
| `coach_client_id` | String? | Foreign key to `coach_clients` (Cascade on delete); pending assignments die with the relationship |
| `status` | String @Default("pending") | Assignment status |
| `created_at` | DateTime | Auto-created |
| `updated_at` | DateTime | Auto-updated |

Unique constraint: `@@unique([coach_client_id])`

> **Transition note (migration `20260922000002_checkin_coach_client_id`)**: `coach_client_id` is nullable in phase 1 so existing rows survive. The migration backfills it from `coach_clients` via `(coach_id, client_id)`; rows with no matching relationship keep NULL and remain readable through the legacy columns. All service reads check the new column first with an `OR` fallback to the legacy columns. Phase 2 (later): set `NOT NULL` and drop the legacy columns.

---

## 3. Supported Question Types

| Type | Description | Answer Format (`answer_value`) | Validation |
|---|---|---|---|
| `NUMBER` | Numeric measurement (weight, waist, etc.) | Non-negative numeric string (e.g. `"72.5"`, `"85"`) | `parseFloat >= 0` |
| `TEXT` | Free-text feedback or reflection | Non-empty string | `trim().length > 0` |
| `SINGLE_CHOICE` | Single selection from predefined options | Option text string matching one of `options` | Must be in `options` array |
| `YES_NO` | Boolean choice (`options: ["Yes", "No"]`) | `"Yes"` or `"No"` | Must be in `options` array |
| `RATING` | Rating scale from 1 to 10 | Integer string between `"1"` and `"10"` | `parseInt >= 1 && <= 10` |
| `IMAGE` | Photo upload (front, side, back) | Cloudinary secure URL | Validated after Cloudinary upload |

---

## 4. API Endpoints Reference

**Base URL**: `/api/v1`  
**Authentication**: All endpoints require a Bearer token in headers:
```http
Authorization: Bearer <jwt_token>
```

---

### 4.1 Coach Endpoints (`/api/v1/coach/checkin`)

> Routes are mounted at `/api/v1/coach/checkin`. Note: `/questions/reorder` must be registered **before** `/questions/:id` so `"reorder"` is not matched as a UUID param.

#### 1. Get My Check-In Questions
- **Method**: `GET`
- **Path**: `/api/v1/coach/checkin/questions`
- **Auth**: Coach only
- **Description**: Returns all check-in questions owned by the authenticated coach, sorted by `order ASC`.
- **Response `200 OK`**:
```json
{
  "questions": [
    {
      "id": "7b8f9e61-9876-4d22-b521-fbb30c6a8501",
      "coach_id": "c1a2b3c4-d5e6-7f8a-9b0c-1d2e3f4a5b6c",
      "question": "Current Weight (kg)",
      "type": "NUMBER",
      "options": [],
      "required": true,
      "order": 1,
      "created_at": "2026-09-21T16:30:00.000Z",
      "updated_at": "2026-09-21T16:30:00.000Z"
    }
  ]
}
```

#### 2. Create a Question
- **Method**: `POST`
- **Path**: `/api/v1/coach/checkin/questions`
- **Auth**: Coach only
- **Request Body**:
```json
{
  "question": "How many hours of sleep did you average?",
  "type": "NUMBER",
  "required": true,
  "order": 25
}
```
*Note: For `SINGLE_CHOICE` and `YES_NO`, provide an `options` array with at least 2 non-empty strings. If `order` is omitted, it auto-assigns `max_order + 1`.*
- **Validation Errors**:
  - `checkin_question_required` — question is missing or empty
  - `checkin_question_too_long` — question exceeds 500 characters
  - `checkin_question_type_invalid` — type is not a valid enum value
  - `checkin_options_required` — SINGLE_CHOICE/YES_NO needs at least 2 options
  - `checkin_options_invalid` — options must be non-empty strings
  - `checkin_order_invalid` — order must be a positive integer
- **Response `201 Created`**: Returns created question object.

#### 3. Update a Question
- **Method**: `PATCH`
- **Path**: `/api/v1/coach/checkin/questions/:id`
- **Auth**: Coach only
- **Request Body** (all fields optional):
```json
{
  "question": "Average Sleep (Hours/Night)",
  "required": false
}
```
- **Validation Errors**: `invalid_request` if no fields provided; `checkin_question_required`, `checkin_question_too_long`, `checkin_question_type_invalid`, `checkin_options_invalid`, `checkin_order_invalid` as applicable.
- **Response `200 OK`**: Returns updated question object.
- **Error `404`**: `checkin_question_not_found` if question doesn't belong to coach.

#### 4. Delete a Question
- **Method**: `DELETE`
- **Path**: `/api/v1/coach/checkin/questions/:id`
- **Auth**: Coach only
- **Response `200 OK`**:
```json
{
  "message": "Check-in question deleted successfully"
}
```
- **Error `400`**: `checkin_cannot_delete_last_question` if only 1 question remains.
- **Error `404`**: `checkin_question_not_found`.

#### 5. Reorder Questions
- **Method**: `PATCH`
- **Path**: `/api/v1/coach/checkin/questions/reorder`
- **Auth**: Coach only
- **Request Body**:
```json
{
  "question_ids": [
    "7b8f9e61-9876-4d22-b521-fbb30c6a8501",
    "e4f1a2b3-c5d6-7e8f-9a0b-1c2d3e4f5a6b"
  ]
}
```
*Note: Must contain ALL question IDs belonging to the coach with no duplicates.*
- **Validation Errors**: `checkin_question_ids_required`, `invalid_uuid`, `checkin_duplicate_question_id`.
- **Response `200 OK`**: Returns questions list in the newly ordered sequence.
- **Error `400`**: `checkin_reorder_ids_mismatch` if IDs don't match all owned questions.

#### 6. Assign Check-In to Client
- **Method**: `POST`
- **Path**: `/api/v1/coach/checkin/assign`
- **Auth**: Coach only
- **Request Body**:
```json
{
  "coach_client_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```
- **Description**: Creates or updates a pending assignment using the `coach_clients` relationship row id. The coach must already have a `coach_clients` entry linking them to the client.
- **Validation Errors**: `coach_client_id_required` if missing/invalid UUID.
- **Response `201 Created`**:
```json
{
  "message": "Check-in assigned",
  "assignment": {
    "id": "a1b2c3d4-...",
    "coach_id": "...",
    "client_id": "...",
    "coach_client_id": "a1b2c3d4-...",
    "status": "pending",
    "created_at": "...",
    "updated_at": "..."
  }
}
```
- **Error `404`**: `client_not_assigned_to_coach` if no `coach_clients` row matches.

#### 7. Get Client Submissions History
- **Method**: `GET`
- **Path**: `/api/v1/coach/checkin/clients/:coachClientId/submissions`
- **Auth**: Coach only
- **Description**: Returns all submissions for the given `coach_clients` relationship. Verifies the coach owns the relationship.
- **Response `200 OK`**:
```json
{
  "submissions": [
    {
      "id": "d1c2b3a4-5678-90ab-cdef-1234567890ab",
      "submitted_at": "2026-09-21T16:40:00.000Z"
    }
  ]
}
```
- **Error `404`**: `client_not_assigned_to_coach` if no matching `coach_clients` row.

#### 8. Get Submission Detail
- **Method**: `GET`
- **Path**: `/api/v1/coach/checkin/clients/:coachClientId/submissions/:submissionId`
- **Auth**: Coach only
- **Description**: Returns full submission detail including client user info and all answers with question snapshots. Verifies the coach owns the `coach_clients` relationship.
- **Response `200 OK`**:
```json
{
  "submission": {
    "id": "d1c2b3a4-5678-90ab-cdef-1234567890ab",
    "coach_id": "c1a2b3c4-d5e6-7f8a-9b0c-1d2e3f4a5b6c",
    "client_id": "f5e4d3c2-b1a0-9876-5432-10fedcba9876",
    "submitted_at": "2026-09-21T16:40:00.000Z",
    "client": {
      "user": {
        "username": "client_hazem",
        "email": "client@example.com"
      }
    },
    "answers": [
      {
        "id": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
        "question_id": "7b8f9e61-9876-4d22-b521-fbb30c6a8501",
        "answer_value": "76.4",
        "question_snapshot": {
          "question": "Current Weight (kg)",
          "type": "NUMBER",
          "options": [],
          "required": true,
          "order": 1
        }
      }
    ]
  }
}
```

---

### 4.2 Client Endpoints (`/api/v1/client/checkin`)

#### 1. Get Coach's Questions
- **Method**: `GET`
- **Path**: `/api/v1/client/checkin/questions`
- **Auth**: Client only
- **Description**: Returns the active questions for the client's assigned coach **only while a pending assignment exists**. With no pending assignment (never assigned, or already submitted), returns `200 { "questions": [] }` — nothing to answer. distinct from `404 no_coach_assigned` when the client has no coach at all.
- **Response `200 OK`**:
```json
{
  "questions": [
    {
      "id": "7b8f9e61-9876-4d22-b521-fbb30c6a8501",
      "question": "Current Weight (kg)",
      "type": "NUMBER",
      "options": [],
      "required": true,
      "order": 1
    }
  ]
}
```

#### 2. Check Pending Assignment
- **Method**: `GET`
- **Path**: `/api/v1/client/checkin/hasassign`
- **Auth**: Client only
- **Description**: Checks if the client has a pending check-in assignment from their coach. Resolves the client's `coach_clients` row internally.
- **Response `200 OK`**:
```json
{
  "has_pending": true
}
```

#### 3. Submit Completed Check-In
- **Method**: `POST`
- **Path**: `/api/v1/client/checkin/submit`
- **Auth**: Client only
- **Content-Type**: `multipart/form-data`
- **Description**: Submits a check-in. Requires a pending assignment (consumed on success).
- **Form Fields**:
  - `answers`: JSON string of answers array:
    ```json
    [
      { "question_id": "7b8f9e61-9876-4d22-b521-fbb30c6a8501", "answer_value": "76.4" },
      { "question_id": "9a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d", "answer_value": "8" }
    ]
    ```
  - **Files**: For each `IMAGE` question, attach the image file where the **field name is the question's `id`** (must be a valid UUID).
- **Validation**:
  - `checkin_answers_required` — answers array is empty or missing
  - `invalid_uuid` — invalid UUID in answers or file fields
  - `checkin_answer_required` — null/undefined answer_value
  - `checkin_invalid_question_id` — question_id doesn't belong to coach
  - `checkin_missing_required_answers` — required questions have no answer
  - `checkin_invalid_number_answer` — NUMBER validation failed
  - `checkin_invalid_rating_answer` — RATING not in 1-10 range
  - `checkin_invalid_choice_answer` — choice not in options
  - `checkin_text_answer_empty` — TEXT answer is empty
  - `checkin_no_pending_assignment` — client has no pending assignment
  - `checkin_answers_invalid_json` — answers field is not valid JSON
- **Response `201 Created`**:
```json
{
  "submission_id": "d1c2b3a4-5678-90ab-cdef-1234567890ab",
  "submitted_at": "2026-09-21T16:40:00.000Z"
}
```

#### 4. Get My Past Submissions
- **Method**: `GET`
- **Path**: `/api/v1/client/checkin/submissions`
- **Auth**: Client only
- **Response `200 OK`**:
```json
{
  "submissions": [
    {
      "id": "d1c2b3a4-5678-90ab-cdef-1234567890ab",
      "submitted_at": "2026-09-21T16:40:00.000Z",
      "coach_id": "c1a2b3c4-d5e6-7f8a-9b0c-1d2e3f4a5b6c"
    }
  ]
}
```

#### 5. Get My Submission Detail
- **Method**: `GET`
- **Path**: `/api/v1/client/checkin/submissions/:submissionId`
- **Auth**: Client only
- **Description**: Returns submission detail including answers with question snapshots. Client can only view their own submissions.
- **Response `200 OK`**: Same structure as coach's submission detail (without client user info).

---

## 5. Validation Details

### `checkin.validation.ts` — All Validation Functions

| Function | Context | Checks |
|---|---|---|
| `validateCreateQuestion` | Coach | question required/≤500, type valid, options for SINGLE_CHOICE/YES_NO (≥2), order positive int |
| `validateUpdateQuestion` | Coach | At least one field, same checks as create |
| `validateReorderQuestions` | Coach | question_ids array non-empty, all valid UUIDs, no duplicates |
| `validateAssignCheckIn` | Coach | `coach_client_id` is valid UUID |
| `validateSubmitCheckIn` | Client | answers array non-empty, each has valid UUID question_id and non-null answer_value |
| `isValidUuid` | Shared | UUID regex check |

### Service-Level Validation (`checkin.service.ts`)

After the controller validation, the service performs additional checks:

1. **Question ownership**: All question IDs must belong to the coach
2. **Required answers**: Every `required: true` question must have a non-empty answer
3. **Answer type validation**: Each answer value is validated against its question type:
   - `NUMBER`: `parseFloat >= 0`
   - `RATING`: `parseInt` between 1 and 10
   - `SINGLE_CHOICE` / `YES_NO`: Value must be in `options` array
   - `TEXT`: Non-empty after trim
   - `IMAGE`: URL validated after Cloudinary upload

---

## 6. File Structure

```
src/modules/checkin/
├── checkin.routes.ts        # Express routers (coach + client)
├── checkin.controller.ts    # Request handlers
├── checkin.service.ts       # Business logic (Prisma + Cloudinary)
├── checkin.validation.ts    # DTO validation functions
└── checkin-defaults.ts      # 24 default questions + seed function
```

### Route Summary

| Method | Path | Role | Controller Method |
|---|---|---|---|
| `GET` | `/coach/checkin/questions` | Coach | `getMyQuestions` |
| `POST` | `/coach/checkin/questions` | Coach | `createQuestion` |
| `PATCH` | `/coach/checkin/questions/reorder` | Coach | `reorderQuestions` |
| `PATCH` | `/coach/checkin/questions/:id` | Coach | `updateQuestion` |
| `DELETE` | `/coach/checkin/questions/:id` | Coach | `deleteQuestion` |
| `POST` | `/coach/checkin/assign` | Coach | `assignCheckIn` |
| `GET` | `/coach/checkin/clients/:coachClientId/submissions` | Coach | `getClientSubmissions` |
| `GET` | `/coach/checkin/clients/:coachClientId/submissions/:submissionId` | Coach | `getSubmissionDetail` |
| `GET` | `/client/checkin/questions` | Client | `getCoachQuestions` |
| `POST` | `/client/checkin/submit` | Client | `submitCheckIn` |
| `GET` | `/client/checkin/hasassign` | Client | `hasPendingAssignment` |
| `GET` | `/client/checkin/submissions` | Client | `getMySubmissions` |
| `GET` | `/client/checkin/submissions/:submissionId` | Client | `getMySubmissionDetail` |

---

## 7. Error Codes

| Error Key | Status | Description |
|---|---|---|
| `checkin_question_not_found` | 404 | Question doesn't exist or doesn't belong to coach |
| `checkin_cannot_delete_last_question` | 400 | Attempt to delete the final question |
| `checkin_reorder_ids_mismatch` | 400 | Reorder IDs don't match all owned questions |
| `checkin_question_ids_required` | 400 | Reorder request missing question_ids |
| `checkin_duplicate_question_id` | 400 | Duplicate ID in reorder request |
| `client_not_assigned_to_coach` | 404 | No `coach_clients` relationship exists or doesn't match |
| `checkin_no_pending_assignment` | 403 | Client has no pending assignment to submit |
| `checkin_submission_not_found` | 404 | Submission not found or doesn't belong to user |
| `checkin_missing_required_answers` | 400 | Required questions have no answers |
| `checkin_invalid_question_id` | 400 | Question ID doesn't belong to the coach |
| `checkin_invalid_number_answer` | 400 | NUMBER answer is not a valid non-negative number |
| `checkin_invalid_rating_answer` | 400 | RATING answer not between 1-10 |
| `checkin_invalid_choice_answer` | 400 | Choice answer not in options |
| `checkin_text_answer_empty` | 400 | TEXT answer is empty |
| `checkin_answers_required` | 400 | Answers array is empty |
| `checkin_answers_invalid_json` | 400 | Answers field is not valid JSON |
| `checkin_question_required` | 400 | Question text is required |
| `checkin_question_too_long` | 400 | Question exceeds 500 characters |
| `checkin_question_type_invalid` | 400 | Invalid question type |
| `checkin_options_required` | 400 | Options required for SINGLE_CHOICE/YES_NO |
| `checkin_options_invalid` | 400 | Options must be non-empty strings |
| `checkin_order_invalid` | 400 | Order must be a positive integer |
| `coach_client_id_required` | 400 | `coach_client_id` is required and must be a valid UUID |
| `invalid_uuid` | 400 | Invalid UUID format (used in validation for question IDs, answer IDs) |
| `checkin_assigned` | 201 | Assignment created successfully |
| `checkin_question_deleted` | 200 | Question deleted successfully |

---

## 8. Default Questions (24 total)

### Body Measurements (12)
1. Current Weight (kg) — NUMBER, required, order 1
2. Neck (cm) — NUMBER, required, order 2
3. Shoulders (cm) — NUMBER, required, order 3
4. Chest (cm) — NUMBER, required, order 4
5. Right Arm – Flexed (cm) — NUMBER, required, order 5
6. Left Arm – Flexed (cm) — NUMBER, required, order 6
7. Waist at Navel (cm) — NUMBER, required, order 7
8. Hips / Glutes (cm) — NUMBER, required, order 8
9. Right Thigh (cm) — NUMBER, required, order 9
10. Left Thigh (cm) — NUMBER, required, order 10
11. Right Calf (cm) — NUMBER, required, order 11
12. Left Calf (cm) — NUMBER, required, order 12

### Progress Photos (3, optional)
13. Progress Photo – Front — IMAGE, **optional**, order 13
14. Progress Photo – Side — IMAGE, **optional**, order 14
15. Progress Photo – Back — IMAGE, **optional**, order 15

### Monthly Reflection (9)
16. How would you rate your overall progress this month? (1–10) — RATING, required, order 16
17. Have you noticed any changes in your body shape this month? — YES_NO, required, order 17
18. What is the biggest improvement you noticed this month? — TEXT, required, order 18
19. Did you achieve your main goal for this month? — SINGLE_CHOICE [Yes, Partially, No], required, order 19
20. What was the biggest challenge you faced this month? — TEXT, required, order 20
21. How satisfied are you with your results this month? (1–10) — RATING, required, order 21
22. Do you feel the current training and nutrition plan is working for you? — SINGLE_CHOICE [Yes, Needs Adjustment], required, order 22
23. What would you like to improve next month? — TEXT, required, order 23
24. Is there anything you want your coach to know? — TEXT, required, order 24

---

## 9. Cloudinary Upload Configuration

- **Folder**: `athletica/checkins`
- **Resource type**: `image`
- **Max file size**: 5 MB
- **Allowed formats**: JPEG, PNG, WEBP
- **Upload method**: `cloudinary.uploader.upload_stream()` via Multer memory storage
- **Controller flow**: `submitCheckIn` → `uploadCheckInPhoto` → store secure URL → create answer
