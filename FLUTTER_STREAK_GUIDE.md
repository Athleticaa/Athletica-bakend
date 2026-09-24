# Flutter Guide — Workout & Nutrition Streak

Four endpoints. No pagination, no query params. Every response covers **assignment start → today** (Cairo calendar days), one entry per day.

## Base & auth

- Base URL: `https://<host>/api/v1` (local: `http://localhost:3000/api/v1`)
- Header on every call: `Authorization: Bearer <jwt>` (client JWT for client routes, coach JWT for coach routes)

## Endpoints

| Who | What | Method & path |
|---|---|---|
| Client | My workout streak | `GET /workout/streak` |
| Client | My nutrition streak | `GET /nutrition/streak` |
| Coach | A client's workout streak | `GET /workout/clients/{coachClientId}/streak` |
| Coach | A client's nutrition streak | `GET /nutrition/clients/{coachClientId}/streak` |

`{coachClientId}` is **`coach_clients.id`** (the assignment id you already use for plans — e.g. from `GET /coach/clients`), **not** the user id or profile id.

## Response shape

⚠️ Envelopes differ by module (existing backend convention):
- **Workout** wraps: `{ "success": true, "data": { … } }` → parse `json['data']`
- **Nutrition** returns the body directly → parse `json` itself

### Workout day

```json
{
  "client_id": "uuid",
  "coach_client_id": "uuid",
  "from": "2026-06-01",
  "to": "2026-09-24",
  "current_streak": 4,
  "longest_streak": 9,
  "total_completed": 60,
  "total_missed": 20,
  "rest_days": 16,
  "total_days": 96,
  "completion_rate": 0.75,
  "days": [
    { "date": "2026-09-24", "status": "completed", "day_number": 2, "day_id": "uuid", "title": "Push", "is_rest": false, "total_exercises": 5, "completed_exercises": 5 },
    { "date": "2026-09-23", "status": "rest", "day_number": 3, "day_id": "uuid", "title": "Rest", "is_rest": true, "total_exercises": 0, "completed_exercises": 0 },
    { "date": "2026-09-22", "status": "missed", "day_number": 1, "day_id": "uuid", "title": "Legs", "is_rest": false, "total_exercises": 5, "completed_exercises": 2 }
  ]
}
```

### Nutrition day

Same summary block (`rest_days` is always `0`), `days[]` items look like:

```json
{ "date": "2026-09-24", "status": "completed", "total_meals": 4, "completed_meals": 4 }
```

## Status meanings & UI mapping

| `status` | Meaning | Suggested UI |
|---|---|---|
| `completed` | All exercises / meals that day done | Green check / filled flame |
| `missed` | Partial or nothing done (incl. days with no logs) | Grey / empty circle |
| `rest` | Scheduled rest day — **not** success or failure (workout only) | Blue "R" badge / moon icon |

Rules your UI can rely on:
- `days` is ascending by `date` and `days.length == total_days`.
- `current_streak` ignores a pending today (it falls back to yesterday), so don't zero the flame before the client trains.
- `completion_rate` already excludes rest days — display as % directly.
- Day boundaries follow **Africa/Cairo** time, matching the rest of the app.

## Dart models

```dart
enum DayStatus { completed, missed, rest }

DayStatus dayStatusFrom(String s) => DayStatus.values.byName(s);

class StreakSummary {
  final String clientId, coachClientId, from, to;
  final int currentStreak, longestStreak, totalCompleted, totalMissed, restDays, totalDays;
  final double completionRate;

  StreakSummary.fromJson(Map<String, dynamic> j)
      : clientId = j['client_id'],
        coachClientId = j['coach_client_id'],
        from = j['from'],
        to = j['to'],
        currentStreak = j['current_streak'],
        longestStreak = j['longest_streak'],
        totalCompleted = j['total_completed'],
        totalMissed = j['total_missed'],
        restDays = j['rest_days'] ?? 0,
        totalDays = j['total_days'],
        completionRate = (j['completion_rate'] as num).toDouble();
}

class WorkoutStreakDay {
  final String date, title;
  final DayStatus status;
  final int? dayNumber;
  final String? dayId;
  final bool isRest;
  final int totalExercises, completedExercises;

  WorkoutStreakDay.fromJson(Map<String, dynamic> j)
      : date = j['date'],
        title = (j['title'] ?? '') as String,
        status = dayStatusFrom(j['status']),
        dayNumber = j['day_number'],
        dayId = j['day_id'],
        isRest = (j['is_rest'] ?? false) as bool,
        totalExercises = j['total_exercises'] ?? 0,
        completedExercises = j['completed_exercises'] ?? 0;
}

class NutritionStreakDay {
  final String date;
  final DayStatus status; // completed | missed only
  final int totalMeals, completedMeals;

  NutritionStreakDay.fromJson(Map<String, dynamic> j)
      : date = j['date'],
        status = dayStatusFrom(j['status']),
        totalMeals = j['total_meals'] ?? 0,
        completedMeals = j['completed_meals'] ?? 0;
}
```

## Service example (package:http)

```dart
import 'dart:convert';
import 'package:http/http.dart' as http;

class StreakApi {
  StreakApi(this.baseUrl, this.token);
  final String baseUrl; // e.g. https://host/api/v1
  final String token;

  Map<String, String> get _headers => {'Authorization': 'Bearer $token'};

  // Workout returns { success, data } — unwrap `data`.
  Future<(StreakSummary, List<WorkoutStreakDay>)> workoutStreak({String? coachClientId, bool coach = false}) async {
    final path = coach ? '/workout/clients/$coachClientId/streak' : '/workout/streak';
    final res = await http.get(Uri.parse('$baseUrl$path'), headers: _headers);
    _throwIfError(res);
    final data = jsonDecode(res.body)['data'] as Map<String, dynamic>;
    return (
      StreakSummary.fromJson(data),
      (data['days'] as List).map((e) => WorkoutStreakDay.fromJson(e)).toList(),
    );
  }

  // Nutrition returns the body directly — no unwrapping.
  Future<(StreakSummary, List<NutritionStreakDay>)> nutritionStreak({String? coachClientId, bool coach = false}) async {
    final path = coach ? '/nutrition/clients/$coachClientId/streak' : '/nutrition/streak';
    final res = await http.get(Uri.parse('$baseUrl$path'), headers: _headers);
    _throwIfError(res);
    final data = jsonDecode(res.body) as Map<String, dynamic>;
    return (
      StreakSummary.fromJson(data),
      (data['days'] as List).map((e) => NutritionStreakDay.fromJson(e)).toList(),
    );
  }

  void _throwIfError(http.Response res) {
    if (res.statusCode < 400) return;
    final body = jsonDecode(res.body);
    throw StreakApiException(res.statusCode, body['error']?.toString() ?? 'unknown');
  }
}

class StreakApiException implements Exception {
  StreakApiException(this.status, this.key);
  final int status;
  final String key; // e.g. assignment_not_found
}
```

## Error handling

| HTTP | Key | When | What to show |
|---|---|---|---|
| 401 | `auth_required` / `token_expired` | Missing/expired JWT | Re-login |
| 403 | `insufficient_permissions` | Coach token on client route or vice versa | Wrong-role bug — check which token you sent |
| 404 | `assignment_not_found` | Client has no coach yet | "No coach assigned" empty state |
| 404 | `client_not_assigned_to_coach` | Coach opened another coach's client | Hide / "client not in your roster" |
| 400 | `invalid_uuid` | Malformed `coachClientId` | Client-side bug — validate the id |

Error bodies are localized (`en`/`ar`) via `Accept-Language`, so match on **status code + `error` key**, never on the message text.

## Suggested screens

- **Client home**: flame + `current_streak`, "best: `longest_streak`", progress bar from `completion_rate`, last-7 strip from `days.reversed.take(7)`.
- **Calendar view**: month grid mapping `date → status` color; `rest` gets its own color, never counted as miss.
- **Coach client profile**: reuse the same widgets, passing `coachClientId`; show both workout and nutrition streaks side by side (there is deliberately **no combined endpoint** — call both).
- **Refresh**: refetch on screen focus and after any complete/uncomplete action; responses are small (one row/day) so no caching needed.
