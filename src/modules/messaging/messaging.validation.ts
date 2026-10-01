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

export interface MediaMessageBody {
  message_type?: unknown;
  content?: unknown;
  caption?: unknown;
  duration_sec?: unknown;
}

export interface MediaFileInfo {
  mimetype: string;
  size: number;
}

export type MediaMessageType = "image" | "voice";

export interface ValidatedMediaMessage {
  messageType: MediaMessageType;
  content: string | null;
  durationSec: number | null;
}

export function validateMediaMessage(
  body: MediaMessageBody | undefined,
  file: MediaFileInfo | undefined,
): { result?: ValidatedMediaMessage; errors: string[] } {
  const errors: string[] = [];
  if (!file) {
    errors.push("attachment_required");
    return { errors };
  }
  // Empty uploads (truncated multipart bodies) carry no playable content.
  if (!file.size) {
    errors.push("attachment_required");
    return { errors };
  }

  const isImage = config.messaging.allowedImageMimes.some((m) => m === file.mimetype);
  const isVoice = config.messaging.allowedVoiceMimes.some((m) => m === file.mimetype);
  if (!isImage && !isVoice) {
    errors.push("message_invalid_file_type");
    return { errors };
  }
  const inferred: MediaMessageType = isImage ? "image" : "voice";

  const rawType = body?.message_type;
  if (rawType !== undefined && rawType !== null && rawType !== "") {
    if (rawType !== "image" && rawType !== "voice") {
      errors.push("invalid_message_type");
      return { errors };
    }
    if (rawType !== inferred) {
      errors.push("invalid_message_type");
      return { errors };
    }
  }
  const messageType = inferred;

  if (messageType === "image" && file.size > config.messaging.imageMaxBytes) {
    errors.push("image_too_large");
    return { errors };
  }
  if (messageType === "voice" && file.size > config.messaging.voiceMaxBytes) {
    errors.push("voice_too_large");
    return { errors };
  }

  // Caption is optional for media; when present it follows the text rules.
  const rawCaption = body?.content ?? body?.caption;
  let content: string | null = null;
  if (rawCaption !== undefined && rawCaption !== null && rawCaption !== "") {
    // Repeated multipart fields parse as arrays, which have no valid caption
    // meaning — reject rather than silently picking one.
    if (typeof rawCaption !== "string") {
      errors.push("message_content_required");
      return { errors };
    }
    const trimmed = rawCaption.trim();
    if (trimmed.length === 0) {
      content = null;
    } else if (trimmed.length > config.messaging.maxContentLength) {
      errors.push("message_content_too_long");
      return { errors };
    } else {
      content = trimmed;
    }
  }

  // duration_sec is voice-only, client-reported metadata (no server probing).
  // Multipart fields arrive as strings — coerce with Number().
  const rawDuration =
    body?.duration_sec ??
    (body as { durationSec?: unknown } | undefined)?.durationSec ??
    (body as { duration?: unknown } | undefined)?.duration;
  let durationSec: number | null = null;
  if (rawDuration !== undefined && rawDuration !== null && rawDuration !== "") {
    if (messageType !== "voice") {
      errors.push("invalid_duration");
      return { errors };
    }
    const parsed = typeof rawDuration === "number" ? rawDuration : Number(rawDuration);
    if (!Number.isInteger(parsed) || parsed < 1) {
      errors.push("invalid_duration");
      return { errors };
    }
    if (parsed > config.messaging.maxVoiceDurationSec) {
      errors.push("voice_too_long");
      return { errors };
    }
    durationSec = parsed;
  }

  return { result: { messageType, content, durationSec }, errors };
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
