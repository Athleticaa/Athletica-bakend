# Realtime Messaging — Flutter Guide (Coach + Client)

Backend: `Athletica-bakend` Express + Prisma + Neon + Ably. This doc is the single contract for building coach/client chat in Flutter.
Base path examples assume `baseUrl = https://api.athletica.app/api/v1` — replace with dev/staging URL.

> **Never embed any Ably API key in the app** — not the Root key, not the Subscribe-only key.
> The app authenticates to Ably exclusively through short-lived token requests minted by
> `GET /realtime/ably-token`. Raw keys stay server-side only.

---

## 1. Concept & roles

| Role | What they do |
|------|--------------|
| Coach | Has many clients. Opens one private conversation per assigned client. Starts with `POST .../by-coach-client/:coachClientId/messages` (lazy-creates it). |
| Client | Has exactly one coach. Starts with the same canonical path using `assignment_id` from `GET /client/coach`. Sees exactly one conversation. Sends/receives in it. |

Core rules:

```
One coach + one assigned client = exactly one conversation.
Neon PostgreSQL = source of truth. Ably = realtime transport only.
Send  = REST POST (server persists, then pushes to Ably).
Read  = REST GET history (works offline-later, no Ably needed).
Live  = Ably subscription on channel `conversation:{conversationId}`, event `message.created`.
```

Message lifecycle:

```
Flutter POST /messaging/conversations/:id/messages {content}
        │
        ▼ (server: persist message + outbox row in ONE transaction → 201)
Flutter shows message immediately from the 201 response
        │
        ▼ (server pushes `message.created` to Ably channel, best-effort)
Other device's Ably subscription fires → append message to list
        │
        ▼ (if the other device was offline: no push received)
Other device GETs history on next open → catches up (Neon is truth)
```

IDs you must not confuse:

- `user.id` (auth) ≠ `coach_profiles.id` ≠ `client_profiles.id`
- `conversation.id` — the chat thread id, used in message/history/token URLs and in the Ably channel name.
- `conversation.coach_client_id` — the coach↔client link row (`coach_clients.id`). Use it to start a chat via the canonical path below.
- `POST .../by-coach-client/:coachClientId` (CANONICAL) takes `coach_clients.id` — the assignment row. **Either coach or client can start.** Coach must own the row via `coach_id`, client must own it via `client_id`, else `403` with a machine-readable `details` code (see §5). Coach gets the id from `GET /coach/clients` (assignment `id`); client gets `assignment_id` from `GET /client/coach` or from `conversation.coach_client_id`.
- `POST .../by-client/:clientId` (DEPRECATED alias, coach-only) takes `client_profiles.id`. Prefer the canonical path.
- All ids are UUIDs. `message.id` ≠ Ably event `id` (the event id is the stable dedupe key, see §6).

---

## 2. Base config (Dio + Ably)

```yaml
# pubspec.yaml
dependencies:
  dio: ^5.7.0
  ably_flutter: ^1.2.0   # verify latest on pub.dev
```

```dart
final dio = Dio(BaseOptions(
  baseUrl: 'https://api.athletica.app/api/v1',
  connectTimeout: const Duration(seconds: 15),
  receiveTimeout: const Duration(seconds: 30),
  headers: {'Accept': 'application/json'},
));

Future<void> attachAuth(String accessToken) async {
  dio.options.headers['Authorization'] = 'Bearer $accessToken';
}
```

- Auth: `Authorization: Bearer <accessToken>` on every call. Missing/expired → 401, wrong role → 403.
- Language: do NOT send `Accept-Language` on messaging calls. Backend defaults to `en`. Errors are `{ error: <translated string>, code: <stable key>, details?: [...] }`. Branch on **HTTP status + `code`/`details`**, never on translated text.
- All messaging calls are JSON (`Content-Type: application/json`).

---

## 3. Data models

### 3.1 `Conversation`

```json
{
  "id": "uuid",
  "coach_client_id": "uuid",
  "coach_id": "uuid",
  "client_id": "uuid",
  "created_at": "2026-09-23T12:00:00.000Z",
  "updated_at": "2026-09-23T12:00:00.000Z",
  "last_message_at": "2026-09-23T12:05:00.000Z"
}
```

```dart
class Conversation {
  final String id;
  final String coachClientId;
  final String coachId;
  final String clientId;
  final DateTime createdAt;
  final DateTime updatedAt;
  final DateTime? lastMessageAt;

  Conversation({
    required this.id,
    required this.coachClientId,
    required this.coachId,
    required this.clientId,
    required this.createdAt,
    required this.updatedAt,
    this.lastMessageAt,
  });

  factory Conversation.fromJson(Map<String, dynamic> j) => Conversation(
        id: j['id'] as String,
        coachClientId: j['coach_client_id'] as String,
        coachId: j['coach_id'] as String,
        clientId: j['client_id'] as String,
        createdAt: DateTime.parse(j['created_at'] as String),
        updatedAt: DateTime.parse(j['updated_at'] as String),
        lastMessageAt: j['last_message_at'] == null
            ? null
            : DateTime.parse(j['last_message_at'] as String),
      );
}
```

### 3.2 `ChatMessage`

```json
{
  "id": "uuid",
  "conversation_id": "uuid",
  "sender_user_id": "uuid",
  "sender_role": "coach",
  "content": "Hello, how was your workout today?",
  "created_at": "2026-09-23T12:00:00.000Z",
  "updated_at": "2026-09-23T12:00:00.000Z"
}
```

```dart
class ChatMessage {
  final String id;
  final String conversationId;
  final String senderUserId;
  final String senderRole; // 'coach' | 'client'
  final String content;
  final DateTime createdAt;

  ChatMessage({
    required this.id,
    required this.conversationId,
    required this.senderUserId,
    required this.senderRole,
    required this.content,
    required this.createdAt,
  });

  factory ChatMessage.fromJson(Map<String, dynamic> j) => ChatMessage(
        id: j['id'] as String,
        conversationId: j['conversation_id'] as String,
        senderUserId: j['sender_user_id'] as String,
        senderRole: j['sender_role'] as String,
        content: j['content'] as String,
        createdAt: DateTime.parse(j['created_at'] as String),
      );

  bool isMine(String myUserId) => senderUserId == myUserId;
}
```

### 3.3 History page

```json
{
  "success": true,
  "data": {
    "messages": [ /* ChatMessage, oldest first */ ],
    "nextCursor": "base64url-string | null",
    "hasMore": false
  }
}
```

### 3.4 Ably token response

```json
{
  "success": true,
  "data": {
    "tokenRequest": { "keyName": "...", "mac": "...", "nonce": "...", "timestamp": 0, "capability": "...", "clientId": "..." },
    "channel": "conversation:{conversationId}",
    "conversationId": "uuid"
  }
}
```

Pass `tokenRequest` straight into `ably.ClientOptions.fromTokenRequest(...)` — never parse or modify it.

---

## 4. REST contract

All responses on success use `{ "success": true, "data": {...} }`. All errors use `{ "error": "<translated>", "code": "<stable key>", "details"?: [...] }` (`code` mirrors the server `messageKey`, e.g. `"forbidden"`; `details` holds machine-readable reasons).

### 4.1 List my conversations

```http
GET /messaging/conversations?limit=50
Authorization: Bearer <coach|client JWT>
```

- Coach → all conversations for their clients, most-recent first. Client → their single conversation.
- `limit` optional, integer `1..50`, default `50`. Invalid → `400 { details: ["invalid_limit"] }`.

```dart
Future<List<Conversation>> listConversations({int limit = 50}) async {
  final res = await dio.get('/messaging/conversations', queryParameters: {'limit': limit});
  final list = res.data['data']['conversations'] as List;
  return list.map((e) => Conversation.fromJson(e)).toList();
}
```

### 4.2 Get one conversation

```http
GET /messaging/conversations/:conversationId
Authorization: Bearer <coach|client JWT>
```

- Not a member → `403 { code: "forbidden", details: ["not_conversation_member"] }`. Unknown id → `404`. Malformed UUID → `400 { details: ["invalid_uuid"] }`.

### 4.3 First message — EITHER side starts (CANONICAL)

```http
POST /messaging/conversations/by-coach-client/:coachClientId/messages
Authorization: Bearer <coach|client JWT>
Content-Type: application/json

{ "content": "Hello, how was your workout today?" }
```

- `:coachClientId` = `coach_clients.id` (the assignment row). Creates the conversation on first use (race-safe), then persists the message. → `201`.
- Ownership: coach must own the row via `coach_id`, client via `client_id`, else `403` (see §5 for `details` codes).
- `content` is trimmed server-side, max 2000 chars. Empty → `400 { details: ["message_content_required"] }`, too long → `400 { details: ["message_content_too_long"] }`.

**Coach bootstrap:** `GET /coach/clients` → assignment `id` → `POST .../by-coach-client/<id>/messages`.

```dart
Future<(Conversation, ChatMessage)> sendFirstMessageAsCoach(String coachClientId, String text) async {
  final res = await dio.post('/messaging/conversations/by-coach-client/$coachClientId/messages', data: {'content': text});
  final data = res.data['data'];
  return (Conversation.fromJson(data['conversation']), ChatMessage.fromJson(data['message']));
}
```

**Client bootstrap:** `GET /client/coach` → `assignment_id` → `POST .../by-coach-client/<assignment_id>/messages`. If `GET /messaging/conversations` is empty, this is the call to make — you do NOT need a `conversationId` first.

```dart
Future<String> getMyAssignmentId() async {
  final res = await dio.get('/client/coach');
  return res.data['assignment_id'] as String; // + res.data['coach'], res.data['assigned_at']
}

Future<(Conversation, ChatMessage)> sendFirstMessageAsClient(String text) async {
  final assignmentId = await getMyAssignmentId();
  final res = await dio.post('/messaging/conversations/by-coach-client/$assignmentId/messages', data: {'content': text});
  final data = res.data['data'];
  return (Conversation.fromJson(data['conversation']), ChatMessage.fromJson(data['message']));
}
```

> DEPRECATED alias: `POST /messaging/conversations/by-client/:clientId/messages` with `client_profiles.id` still works but prefer the canonical path above.

### 4.4 Send to an existing conversation (coach + client)

```http
POST /messaging/conversations/:conversationId/messages
Authorization: Bearer <coach|client JWT>
Content-Type: application/json

{ "content": "Well done, keep it up!" }
```

- Must be a member of the conversation, else `403 { details: ["not_conversation_member"] }`. Unknown id → `404`. Malformed UUID → `400 { details: ["invalid_uuid"] }`.
- → `201` with `{ message, conversation }`. Render `message` immediately; the Ably push follows best-effort.

```dart
Future<ChatMessage> sendToConversation(String conversationId, String text) async {
  final res = await dio.post('/messaging/conversations/$conversationId/messages', data: {'content': text});
  return ChatMessage.fromJson(res.data['data']['message']);
}
```

### 4.5 Get message history (Neon is source of truth)

```http
GET /messaging/conversations/:conversationId/messages?limit=50&before=<cursor>
Authorization: Bearer <coach|client JWT>
```

- `messages` oldest first. `limit` 1..50, default 50. `before` is the opaque `nextCursor` from the previous page; omit for the first page.
- Invalid cursor → `400 { details: ["invalid_cursor"] }`. Not a member → `403 { details: ["not_conversation_member"] }`.

```dart
Future<HistoryPage> getHistory(String conversationId, {String? before, int limit = 50}) async {
  final res = await dio.get('/messaging/conversations/$conversationId/messages', queryParameters: {
    'limit': limit, if (before != null) 'before': before,
  });
  final data = res.data['data'];
  return HistoryPage(messages: (data['messages'] as List).map((e) => ChatMessage.fromJson(e)).toList(), nextCursor: data['nextCursor'], hasMore: data['hasMore']);
}
```

### 4.6 Realtime token + live subscription (Ably, subscribe-only)

```http
GET /realtime/ably-token?conversationId=:conversationId
Authorization: Bearer <coach|client JWT>
```

- Channel: `conversation:{conversationId}`, event: `message.created`. Capability is subscribe+history only — the client can never publish.
- Pass `data.tokenRequest` straight into `ably.ClientOptions.fromTokenRequest(...)`. Never embed any Ably key in the app.
- Dedup on Ably event `id` (stable across retries); `message.id` is the REST id.

---

## 5. Error contract

| Status | Meaning |
|--------|---------|
| 400 | `invalid_uuid` / `message_content_required` / `message_content_too_long` / `invalid_limit` / `invalid_cursor` |
| 401 | Missing/expired JWT |
| 403 | `code: "forbidden"` or `"insufficient_permissions"` + `details` (see table below) |
| 404 | Conversation not found (`code: "conversation_not_found"`) / profile not found |

Branch on HTTP status + `code`/`details`, never on translated `error` text. Do not send `Accept-Language` on messaging calls.

### 5.1 `403 details` codes (messaging)

| `details[0]` | When | What to do in Flutter |
|---|---|---|
| `assignment_not_found` | `POST .../by-coach-client/:id` with unknown `coach_clients.id` (wrong id, stale id after `leave-coach`, or client removed) | Re-fetch `GET /coach/clients` (coach) or `GET /client/coach → assignment_id` (client), then retry with the fresh id |
| `not_assignment_owner` | Id exists but belongs to another coach/client | You passed someone else's assignment id — check you used your own list/`assignment_id` |
| `not_conversation_member` | `GET`/`POST` on a `conversationId` you are not a member of | Re-fetch `GET /messaging/conversations` and use your own `conversation.id` |
| `assignment_missing_for_conversation` | Conversation row points at a deleted assignment (rare, after roster change) | Re-fetch list; if empty, send a fresh first message via the canonical path |
| `insufficient_permissions` (`code`) | Wrong role for a coach-only route (e.g. client on deprecated `POST .../by-client/:clientId`) | Use the canonical `by-coach-client` path instead |

Example:

```json
{ "error": "Forbidden", "code": "forbidden", "details": ["assignment_not_found"] }
```

Troubleshooting checklist when you see `403`:
1. Log `code` + `details[0]` (not just `error`).
2. Confirm `Authorization` role matches the route (canonical accepts `coach` + `client`; deprecated `by-client/:clientId` is coach-only).
3. Confirm the id kind: canonical takes `coach_clients.id`, NOT `user.id` / `client_profiles.id` / `conversation.id`.
4. Coach: verify the id is in your `GET /coach/clients` list. Client: verify it equals `GET /client/coach → assignment_id`.
5. After `leave-coach` / `remove-client`, old ids are dead → re-bootstrap.
