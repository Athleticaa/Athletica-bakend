import {
  encodeMessageCursor,
  isValidUuid,
  parseMessageCursor,
  parseMessageHistoryQuery,
  validateSendMessage,
} from "../../src/modules/messaging/messaging.validation";
import { config } from "../../src/config";

const VALID_UUID = "123e4567-e89b-12d3-a456-426614174000";
const OTHER_UUID = "123e4567-e89b-12d3-a456-426614174001";

describe("isValidUuid", () => {
  it("accepts a well-formed UUID", () => {
    expect(isValidUuid(VALID_UUID)).toBe(true);
  });

  it("accepts uppercase UUIDs", () => {
    expect(isValidUuid(VALID_UUID.toUpperCase())).toBe(true);
  });

  it("rejects malformed strings", () => {
    expect(isValidUuid("not-a-uuid")).toBe(false);
    expect(isValidUuid("")).toBe(false);
    expect(isValidUuid(VALID_UUID.slice(0, 35))).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(isValidUuid(undefined)).toBe(false);
    expect(isValidUuid(null)).toBe(false);
    expect(isValidUuid(123)).toBe(false);
    expect(isValidUuid({})).toBe(false);
  });
});

describe("validateSendMessage", () => {
  it("accepts valid content", () => {
    const result = validateSendMessage({ content: "Hello, coach!" });
    expect(result.errors).toEqual([]);
    expect(result.content).toBe("Hello, coach!");
  });

  it("trims surrounding whitespace", () => {
    const result = validateSendMessage({ content: "  hi  " });
    expect(result.errors).toEqual([]);
    expect(result.content).toBe("hi");
  });

  it("rejects missing or undefined bodies", () => {
    expect(validateSendMessage(undefined).errors).toContain("message_content_required");
    expect(validateSendMessage({}).errors).toContain("message_content_required");
  });

  it("rejects non-string content", () => {
    expect(validateSendMessage({ content: 42 as unknown as string }).errors).toContain(
      "message_content_required"
    );
  });

  it("rejects empty and whitespace-only content", () => {
    expect(validateSendMessage({ content: "" }).errors).toContain("message_content_required");
    expect(validateSendMessage({ content: "   " }).errors).toContain("message_content_required");
  });

  it("rejects content longer than the configured max", () => {
    const tooLong = "a".repeat(config.messaging.maxContentLength + 1);
    expect(validateSendMessage({ content: tooLong }).errors).toContain("message_content_too_long");
  });

  it("accepts content exactly at the configured max", () => {
    const atMax = "a".repeat(config.messaging.maxContentLength);
    const result = validateSendMessage({ content: atMax });
    expect(result.errors).toEqual([]);
    expect(result.content?.length).toBe(config.messaging.maxContentLength);
  });
});

describe("message cursor encode/decode", () => {
  it("round-trips a cursor", () => {
    const createdAt = new Date("2026-09-23T12:00:00.000Z");
    const encoded = encodeMessageCursor({ createdAt, id: VALID_UUID });
    expect(typeof encoded).toBe("string");

    const parsed = parseMessageCursor(encoded);
    expect(parsed).not.toBeNull();
    expect(parsed?.id).toBe(VALID_UUID);
    expect(parsed?.createdAt.toISOString()).toBe(createdAt.toISOString());
  });

  it("returns null for absent cursors", () => {
    expect(parseMessageCursor(undefined)).toBeNull();
    expect(parseMessageCursor(null)).toBeNull();
    expect(parseMessageCursor("")).toBeNull();
  });

  it("returns null for malformed cursors", () => {
    expect(parseMessageCursor("not-base64!!!")).toBeNull();
    expect(parseMessageCursor(123)).toBeNull();
    expect(parseMessageCursor([OTHER_UUID])).toBeNull();
  });

  it("returns null when the embedded id is not a UUID", () => {
    const bad = Buffer.from(
      JSON.stringify({ createdAt: new Date().toISOString(), id: "nope" }),
      "utf8"
    ).toString("base64url");
    expect(parseMessageCursor(bad)).toBeNull();
  });

  it("returns null when the embedded date is invalid", () => {
    const bad = Buffer.from(
      JSON.stringify({ createdAt: "not-a-date", id: VALID_UUID }),
      "utf8"
    ).toString("base64url");
    expect(parseMessageCursor(bad)).toBeNull();
  });
});

describe("parseMessageHistoryQuery", () => {
  const cursorFor = () =>
    encodeMessageCursor({ createdAt: new Date("2026-09-23T12:00:00.000Z"), id: VALID_UUID });

  it("applies the default limit when no query is given", () => {
    const { result, errors } = parseMessageHistoryQuery({});
    expect(errors).toEqual([]);
    expect(result?.limit).toBe(config.messaging.defaultLimit);
    expect(result?.before).toBeUndefined();
  });

  it("accepts a valid string limit and cursor", () => {
    const before = cursorFor();
    const { result, errors } = parseMessageHistoryQuery({ limit: "10", before });
    expect(errors).toEqual([]);
    expect(result?.limit).toBe(10);
    expect(result?.before?.id).toBe(VALID_UUID);
  });

  it("treats an empty-string cursor as absent", () => {
    const { result, errors } = parseMessageHistoryQuery({ before: "" });
    expect(errors).toEqual([]);
    expect(result?.before).toBeUndefined();
  });

  it("rejects out-of-range and non-integer limits", () => {
    for (const limit of ["0", "-1", "1.5", "abc", "", "100000"]) {
      expect(parseMessageHistoryQuery({ limit }).errors).toContain("invalid_limit");
    }
    expect(
      parseMessageHistoryQuery({ limit: String(config.messaging.maxLimit + 1) }).errors
    ).toContain("invalid_limit");
    expect(parseMessageHistoryQuery({ limit: ["10"] }).errors).toContain("invalid_limit");
  });

  it("accepts a limit exactly at the configured max", () => {
    const { result, errors } = parseMessageHistoryQuery({
      limit: String(config.messaging.maxLimit),
    });
    expect(errors).toEqual([]);
    expect(result?.limit).toBe(config.messaging.maxLimit);
  });

  it("rejects malformed cursors", () => {
    const { errors } = parseMessageHistoryQuery({ before: "bad-cursor" });
    expect(errors).toContain("invalid_cursor");
  });

  it("reports both errors when limit and cursor are invalid", () => {
    const { errors, result } = parseMessageHistoryQuery({ limit: "0", before: "bad" });
    expect(errors).toContain("invalid_limit");
    expect(errors).toContain("invalid_cursor");
    expect(result).toBeUndefined();
  });
});
