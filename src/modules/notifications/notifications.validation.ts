import { isValidUuid } from "../messaging/messaging.validation";

/**
 * Inbox event types. `chat_message` is intentionally excluded: chat already
 * has full history via the messaging APIs, so the inbox would double-notify
 * a high-volume channel. Chat badges must come from conversations/unread
 * state, never from `GET /notifications` or `/unread-count`.
 */
export const NOTIFICATION_TYPES = [
  "coach_request",
  "request_accepted",
  "workout_assigned",
  "nutrition_assigned",
  "checkin_requested",
  "checkin_submitted",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export function isNotificationType(value: unknown): value is NotificationType {
  return (
    typeof value === "string" &&
    (NOTIFICATION_TYPES as readonly string[]).includes(value)
  );
}

export interface NotificationCursor {
  createdAt: Date;
  id: string;
}

export interface NotificationListQuery {
  before?: NotificationCursor;
  limit: number;
  unreadOnly: boolean;
  /** Default true: opening the inbox marks the returned page read. */
  autoRead: boolean;
}

export function encodeNotificationCursor(cursor: NotificationCursor): string {
  return Buffer.from(
    JSON.stringify({ createdAt: cursor.createdAt.toISOString(), id: cursor.id }),
    "utf8",
  ).toString("base64url");
}

export function parseNotificationCursor(value: unknown): NotificationCursor | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || Array.isArray(value)) return null;

  try {
    const decoded = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as { createdAt?: unknown; id?: unknown };
    if (typeof decoded.createdAt !== "string" || !isValidUuid(decoded.id)) return null;

    const createdAt = new Date(decoded.createdAt);
    if (Number.isNaN(createdAt.getTime())) return null;

    return { createdAt, id: decoded.id as string };
  } catch {
    return null;
  }
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function parseLimit(rawLimit: unknown): { limit?: number; error?: string } {
  if (rawLimit === undefined) return { limit: DEFAULT_LIMIT };
  let parsed: number;
  if (typeof rawLimit === "number") {
    parsed = rawLimit;
  } else if (typeof rawLimit === "string" && rawLimit.trim() !== "") {
    parsed = Number(rawLimit);
  } else {
    return { error: "invalid_limit" };
  }
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
    return { error: "invalid_limit" };
  }
  return { limit: parsed };
}

export function parseNotificationListQuery(
  query: Record<string, unknown>,
): { result?: NotificationListQuery; errors: string[] } {
  const errors: string[] = [];

  const { limit, error: limitError } = parseLimit(query.limit);
  if (limitError || limit === undefined) errors.push("invalid_limit");

  const rawBefore = query.before ?? query.cursor;
  const rawBeforeAbsent = rawBefore === undefined || rawBefore === null || rawBefore === "";
  const before = rawBeforeAbsent ? null : parseNotificationCursor(rawBefore);
  if (!rawBeforeAbsent && before === null) {
    errors.push("invalid_cursor");
  }

  const rawUnread = query.unread_only ?? query.unreadOnly;
  let unreadOnly = false;
  if (rawUnread !== undefined && rawUnread !== null && rawUnread !== "") {
    if (rawUnread === true || rawUnread === "true" || rawUnread === "1") {
      unreadOnly = true;
    } else if (rawUnread === false || rawUnread === "false" || rawUnread === "0") {
      unreadOnly = false;
    } else {
      errors.push("invalid_unread_only");
    }
  }

  // Opt-out for prefetch/poll clients: ?auto_read=false keeps GET side-effect
  // free and leaves badge state untouched.
  const rawAutoRead = query.auto_read ?? query.autoRead;
  let autoRead = true;
  if (rawAutoRead !== undefined && rawAutoRead !== null && rawAutoRead !== "") {
    if (rawAutoRead === true || rawAutoRead === "true" || rawAutoRead === "1") {
      autoRead = true;
    } else if (rawAutoRead === false || rawAutoRead === "false" || rawAutoRead === "0") {
      autoRead = false;
    } else {
      errors.push("invalid_auto_read");
    }
  }

  if (errors.length > 0) return { errors };
  return { result: { before: before ?? undefined, limit: limit!, unreadOnly, autoRead }, errors };
}

export function validateNotificationId(value: unknown): boolean {
  return isValidUuid(value);
}
