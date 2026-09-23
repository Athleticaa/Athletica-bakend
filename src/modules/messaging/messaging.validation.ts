import { config } from "../../config";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SendMessageInput {
  content: string;
}

export interface MessageCursor {
  createdAt: Date;
  id: string;
}

export interface MessageHistoryQuery {
  before?: MessageCursor;
  limit: number;
}

export function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value);
}

export function validateSendMessage(input: Partial<SendMessageInput> | undefined): { content?: string; errors: string[] } {
  const errors: string[] = [];
  const rawContent = input?.content;

  if (typeof rawContent !== "string") {
    errors.push("message_content_required");
    return { errors };
  }

  const content = rawContent.trim();
  if (content.length === 0) {
    errors.push("message_content_required");
  } else if (content.length > config.messaging.maxContentLength) {
    errors.push("message_content_too_long");
  }

  return errors.length > 0 ? { errors } : { content, errors };
}

export function encodeMessageCursor(cursor: MessageCursor): string {
  return Buffer.from(JSON.stringify({ createdAt: cursor.createdAt.toISOString(), id: cursor.id }), "utf8").toString("base64url");
}

export function parseMessageCursor(value: unknown): MessageCursor | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || Array.isArray(value)) return null;

  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { createdAt?: unknown; id?: unknown };
    if (typeof decoded.createdAt !== "string" || !isValidUuid(decoded.id)) return null;

    const createdAt = new Date(decoded.createdAt);
    if (Number.isNaN(createdAt.getTime())) return null;

    return { createdAt, id: decoded.id };
  } catch {
    return null;
  }
}

export function parseMessageHistoryQuery(query: Record<string, unknown>): { result?: MessageHistoryQuery; errors: string[] } {
  const errors: string[] = [];
  const rawLimit = query.limit;
  const rawBefore = query.before;

  let limit: number = config.messaging.defaultLimit;
  if (rawLimit !== undefined) {
    if (typeof rawLimit === "number") {
      if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > config.messaging.maxLimit) {
        errors.push("invalid_limit");
      } else {
        limit = rawLimit;
      }
    } else if (Array.isArray(rawLimit) || typeof rawLimit !== "string" || rawLimit.trim() === "") {
      errors.push("invalid_limit");
    } else {
      const parsed = Number(rawLimit);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > config.messaging.maxLimit) {
        errors.push("invalid_limit");
      } else {
        limit = parsed;
      }
    }
  }

  const rawBeforeAbsent = rawBefore === undefined || rawBefore === null || rawBefore === "";
  const before = rawBeforeAbsent ? null : parseMessageCursor(rawBefore);
  if (!rawBeforeAbsent && before === null) {
    errors.push("invalid_cursor");
  }

  if (errors.length > 0) return { errors };
  return { result: { before: before ?? undefined, limit }, errors };
}
