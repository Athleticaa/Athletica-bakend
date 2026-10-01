import { validateMediaMessage } from "../../src/modules/messaging/messaging.validation";
import { config } from "../../src/config";

const jpg = { mimetype: "image/jpeg", size: 412800 };
const mp3 = { mimetype: "audio/mpeg", size: 1024 * 1024 };

describe("validateMediaMessage", () => {
  it("accepts an image with explicit type and caption", () => {
    const { result, errors } = validateMediaMessage(
      { message_type: "image", content: "  Form check  " },
      jpg
    );
    expect(errors).toEqual([]);
    expect(result?.messageType).toBe("image");
    expect(result?.content).toBe("Form check");
    expect(result?.durationSec).toBeNull();
  });

  it("accepts an image without caption and infers the type", () => {
    const { result, errors } = validateMediaMessage({}, jpg);
    expect(errors).toEqual([]);
    expect(result?.messageType).toBe("image");
    expect(result?.content).toBeNull();
  });

  it("accepts caption via the caption alias", () => {
    const { result, errors } = validateMediaMessage({ caption: "hi" }, jpg);
    expect(errors).toEqual([]);
    expect(result?.content).toBe("hi");
  });

  it("accepts voice with string duration and infers the type", () => {
    const { result, errors } = validateMediaMessage(
      { duration_sec: "187", content: "cue" },
      mp3
    );
    expect(errors).toEqual([]);
    expect(result?.messageType).toBe("voice");
    expect(result?.durationSec).toBe(187);
  });

  it("accepts voice without duration", () => {
    const { result, errors } = validateMediaMessage({ message_type: "voice" }, mp3);
    expect(errors).toEqual([]);
    expect(result?.durationSec).toBeNull();
  });

  it("accepts duration at the configured max", () => {
    const { result, errors } = validateMediaMessage(
      { duration_sec: String(config.messaging.maxVoiceDurationSec) },
      mp3
    );
    expect(errors).toEqual([]);
    expect(result?.durationSec).toBe(config.messaging.maxVoiceDurationSec);
  });

  it("rejects a missing file", () => {
    expect(validateMediaMessage({ content: "hi" }, undefined).errors).toContain(
      "attachment_required"
    );
  });

  it("rejects disallowed MIME types", () => {
    const { errors } = validateMediaMessage(
      {},
      { mimetype: "application/pdf", size: 100 }
    );
    expect(errors).toContain("message_invalid_file_type");
  });

  it("rejects zero-byte files as missing attachments", () => {
    expect(validateMediaMessage({}, { mimetype: "image/jpeg", size: 0 }).errors).toContain(
      "attachment_required"
    );
  });

  it("rejects type/MIME mismatches and unknown types", () => {
    expect(
      validateMediaMessage({ message_type: "image" }, mp3).errors
    ).toContain("invalid_message_type");
    expect(
      validateMediaMessage({ message_type: "voice" }, jpg).errors
    ).toContain("invalid_message_type");
    expect(validateMediaMessage({ message_type: "video" }, jpg).errors).toContain(
      "invalid_message_type"
    );
  });

  it("rejects oversize images and audio with type-specific keys", () => {
    expect(
      validateMediaMessage(
        {},
        { mimetype: "image/jpeg", size: config.messaging.imageMaxBytes + 1 }
      ).errors
    ).toContain("image_too_large");
    expect(
      validateMediaMessage(
        {},
        { mimetype: "audio/mpeg", size: config.messaging.voiceMaxBytes + 1 }
      ).errors
    ).toContain("voice_too_large");
  });

  it("rejects overlong captions", () => {
    const tooLong = "a".repeat(config.messaging.maxContentLength + 1);
    expect(validateMediaMessage({ content: tooLong }, jpg).errors).toContain(
      "message_content_too_long"
    );
  });

  it("rejects out-of-range and malformed durations", () => {
    expect(
      validateMediaMessage(
        { duration_sec: String(config.messaging.maxVoiceDurationSec + 1) },
        mp3
      ).errors
    ).toContain("voice_too_long");
    for (const bad of ["abc", "1.5", "0", "-3"]) {
      expect(validateMediaMessage({ duration_sec: bad }, mp3).errors).toContain(
        "invalid_duration"
      );
    }
  });

  it("treats empty-string duration as absent", () => {
    const { result, errors } = validateMediaMessage({ duration_sec: "" }, mp3);
    expect(errors).toEqual([]);
    expect(result?.durationSec).toBeNull();
  });

  it("rejects duration on image messages", () => {
    expect(validateMediaMessage({ duration_sec: "10" }, jpg).errors).toContain(
      "invalid_duration"
    );
  });

  it("accepts every configured voice MIME type", () => {
    for (const mimetype of config.messaging.allowedVoiceMimes) {
      const { result, errors } = validateMediaMessage(
        { message_type: "voice", duration_sec: 60 },
        { mimetype, size: 1024 }
      );
      expect(errors).toEqual([]);
      expect(result?.messageType).toBe("voice");
    }
  });

  it("accepts every configured image MIME type", () => {
    for (const mimetype of config.messaging.allowedImageMimes) {
      const { result, errors } = validateMediaMessage(
        { message_type: "image" },
        { mimetype, size: 1024 }
      );
      expect(errors).toEqual([]);
      expect(result?.messageType).toBe("image");
    }
  });
});
