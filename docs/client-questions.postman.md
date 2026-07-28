# Client Questions & Answers — Postman Collection

## Base URL

```
http://localhost:3000
```

## Authentication

The `answers` endpoints require a **Bearer token** in the `Authorization` header.
Obtain a token via signup or login.

```
Authorization: Bearer <token>
```

---

## 0. Signup (auto-creates profile)

Signing up automatically creates a `client_profiles` or `coach_profiles` record based on the selected role.

### Request

| Method | Endpoint       |
| ------ | -------------- |
| POST   | `/auth/signup` |

**Headers**

| Key          | Value                |
| ------------ | -------------------- |
| Content-Type | `application/json`   |

**Body** (client role)

```json
{
  "first_name": "John",
  "last_name": "Doe",
  "email": "client@example.com",
  "password": "password123",
  "role": "client",
  "gender": "male",
  "goal": "lose_weight"
}
```

**Body** (coach role)

```json
{
  "first_name": "Jane",
  "last_name": "Smith",
  "email": "coach@example.com",
  "password": "password123",
  "role": "coach",
  "bio": "Certified personal trainer with 5 years experience",
  "specialization": "weight_loss"
}
```

> `gender` / `goal` (client) and `bio` / `specialization` (coach) are optional. If omitted, defaults are used.

### Response

| Status | Description                    |
| ------ | ------------------------------ |
| 200    | Verification code sent to email |
| 409    | Email already registered        |

---

## 1. GET Questions

Fetch all questions in the language of your `Accept-Language` header.

### Request

| Method | Endpoint            |
| ------ | ------------------- |
| GET    | `/client/questions` |

**Headers**

| Key              | Value        |
| ---------------- | ------------ |
| Accept-Language  | `en` or `ar` |

### Responses

<details open>
<summary><code>200 OK</code> — English (Accept-Language: en)</summary>

```json
{
  "questions": [
    {
      "id": "uuid-1",
      "question": "Have you had any past injuries?",
      "choices": [
        "No injuries",
        "Minor injuries (fully recovered)",
        "Previous injuries (sometimes feel pain)",
        "Serious injury",
        "Currently injured"
      ],
      "language": "en",
      "created_at": "2026-07-28T00:00:00.000Z"
    }
  ]
}
```

</details>

<details>
<summary><code>200 OK</code> — Arabic (Accept-Language: ar)</summary>

```json
{
  "questions": [
    {
      "id": "uuid-1",
      "question": "هل تعرضت لأي إصابات سابقة؟",
      "choices": [
        "لا توجد إصابات",
        "إصابات طفيفة (تعافيت تماماً)",
        "إصابات سابقة (أشعر بألم أحياناً)",
        "إصابة خطيرة",
        "مصاب حالياً"
      ],
      "language": "ar",
      "created_at": "2026-07-28T00:00:00.000Z"
    }
  ]
}
```

</details>

---

## 2. POST Answers

Submit answers for the first time. Fails with `409` if any question already has an answer.

### Request

| Method | Endpoint            | Auth Required |
| ------ | ------------------- | ------------- |
| POST   | `/client/answers`   | Yes (client)  |

**Headers**

| Key              | Value                     |
| ---------------- | ------------------------- |
| Authorization    | `Bearer <token>`          |
| Content-Type     | `application/json`        |

**Body** (answer is the **index** of the selected choice, 0-based)

```json
{
  "answers": [
    {
      "question_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      "answer": 0
    },
    {
      "question_id": "f47ac10b-58cc-4372-a567-0e02b2c3d47a",
      "answer": 1
    }
  ]
}
```

### Responses

<details open>
<summary><code>201 Created</code></summary>

```json
{
  "message": "answers_created"
}
```

</details>

<details>
<summary><code>400 Bad Request</code> — validation failed</summary>

```json
{
  "error": "validation_failed",
  "details": [
    "question_id_required at index 0"
  ]
}
```

</details>

<details>
<summary><code>400 Bad Request</code> — answer index out of range</summary>

```json
{
  "error": "answer_out_of_range"
}
```

</details>

<details>
<summary><code>409 Conflict</code> — answers already exist</summary>

```json
{
  "error": "answers_already_exist"
}
```

</details>

<details>
<summary><code>401 Unauthorized</code> — missing/invalid token</summary>

```json
{
  "error": "Authentication required"
}
```

</details>

---

## 3. PATCH Answers

Update existing answers. Fails with `404` if any question hasn't been answered yet.

### Request

| Method | Endpoint            | Auth Required |
| ------ | ------------------- | ------------- |
| PATCH  | `/client/answers`   | Yes (client)  |

**Headers**

| Key              | Value                     |
| ---------------- | ------------------------- |
| Authorization    | `Bearer <token>`          |
| Content-Type     | `application/json`        |

**Body** (answer is the **index** of the selected choice, 0-based)

```json
{
  "answers": [
    {
      "question_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      "answer": 1
    }
  ]
}
```

### Responses

<details open>
<summary><code>200 OK</code></summary>

```json
{
  "message": "answers_updated"
}
```

</details>

<details>
<summary><code>404 Not Found</code> — answer doesn't exist yet</summary>

```json
{
  "error": "answers_not_found"
}
```

</details>

---

## 4. GET Answers

Fetch the current client's submitted answers.

### Request

| Method | Endpoint            | Auth Required |
| ------ | ------------------- | ------------- |
| GET    | `/client/answers`   | Yes (client)  |

**Headers**

| Key              | Value                     |
| ---------------- | ------------------------- |
| Authorization    | `Bearer <token>`          |

### Response

The question text and choice text are returned in the language of your `Accept-Language` header.

<details open>
<summary><code>200 OK</code> — English (Accept-Language: en)</summary>

```json
{
  "answers": [
    {
      "id": "uuid-answer-1",
      "client_id": "uuid-client-profile",
      "question_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      "answer": 0,
      "answer_text": "No injuries",
      "created_at": "2026-07-28T00:00:00.000Z",
      "question": "Have you had any past injuries?"
    }
  ]
}
```

</details>

<details>
<summary><code>200 OK</code> — Arabic (Accept-Language: ar)</summary>

```json
{
  "answers": [
    {
      "id": "uuid-answer-1",
      "client_id": "uuid-client-profile",
      "question_id": "uuid-english-question-id",
      "answer": 0,
      "answer_text": "لا توجد إصابات",
      "created_at": "2026-07-28T00:00:00.000Z",
      "question": "هل تعرضت لأي إصابات سابقة؟"
    }
  ]
}
```

</details>

---

## Postman Import (JSON)

Save the following as `client-questions.postman_collection.json` and import into Postman:

```json
{
  "info": {
    "name": "Athletica - Client Questions & Answers",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "item": [
    {
      "name": "GET Questions",
      "request": {
        "method": "GET",
        "header": [
          { "key": "Accept-Language", "value": "en", "type": "text" }
        ],
        "url": {
          "raw": "http://localhost:3000/client/questions",
          "protocol": "http",
          "host": ["localhost"],
          "port": "3000",
          "path": ["client", "questions"]
        }
      }
    },
    {
      "name": "POST Answers",
      "request": {
        "method": "POST",
        "header": [
          { "key": "Authorization", "value": "Bearer {{token}}", "type": "text" },
          { "key": "Content-Type", "value": "application/json", "type": "text" }
        ],
        "body": {
          "mode": "raw",
          "raw": "{\n  \"answers\": [\n    {\n      \"question_id\": \"f47ac10b-58cc-4372-a567-0e02b2c3d479\",\n      \"answer\": 0\n    }\n  ]\n}"
        },
        "url": {
          "raw": "http://localhost:3000/client/answers",
          "protocol": "http",
          "host": ["localhost"],
          "port": "3000",
          "path": ["client", "answers"]
        }
      }
    },
    {
      "name": "PATCH Answers",
      "request": {
        "method": "PATCH",
        "header": [
          { "key": "Authorization", "value": "Bearer {{token}}", "type": "text" },
          { "key": "Content-Type", "value": "application/json", "type": "text" }
        ],
        "body": {
          "mode": "raw",
          "raw": "{\n  \"answers\": [\n    {\n      \"question_id\": \"f47ac10b-58cc-4372-a567-0e02b2c3d479\",\n      \"answer\": 1\n    }\n  ]\n}"
        },
        "url": {
          "raw": "http://localhost:3000/client/answers",
          "protocol": "http",
          "host": ["localhost"],
          "port": "3000",
          "path": ["client", "answers"]
        }
      }
    },
    {
      "name": "GET Answers",
      "request": {
        "method": "GET",
        "header": [
          { "key": "Authorization", "value": "Bearer {{token}}", "type": "text" }
        ],
        "url": {
          "raw": "http://localhost:3000/client/answers",
          "protocol": "http",
          "host": ["localhost"],
          "port": "3000",
          "path": ["client", "answers"]
        }
      }
    }
  ]
}
```

---

## Environment Variables (Postman)

Create a Postman environment with:

| Variable | Initial Value                        |
| -------- | ------------------------------------ |
| `token`  | *(paste JWT from login response)*    |
