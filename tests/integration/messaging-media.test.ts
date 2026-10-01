import jwt from "jsonwebtoken";
import path from "path";
import request from "supertest";
import app from "../../src/app";
import { config } from "../../src/config";
import { MessagingService } from "../../src/modules/messaging/messaging.service";

const SECRET = process.env.JWT_SECRET || "change-me-to-a-random-secret-in-production";
const CONV_ID = "123e4567-e89b-12d3-a456-426614174000";
const COACH_CLIENT_ID = "223e4567-e89b-12d3-a456-426614174000";
const IMG = path.join(__dirname, "..", "fixtures", "sample.jpg");
const MP3 = path.join(__dirname, "..", "fixtures", "sample.mp3");
const PDF = path.join(__dirname, "..", "fixtures", "sample.pdf");

function token(sub: string, role: string) {
  return jwt.sign({ sub, email: `${sub}@test.com`, role }, SECRET, { expiresIn: "1h" });
}

const MESSAGE_ID = "323e4567-e89b-12d3-a456-426614174000";

function fakeSendResult(content: string | null) {
  const now = new Date();
  const message = {
    id: MESSAGE_ID,
    conversation_id: CONV_ID,
    sender_user_id: "coach-user",
    sender_role: "coach",
    content,
    message_type: "image",
    attachment_url: "https://mock.cloudinary.com/image/upload/msg.jpg",
    attachment_mime: "image/jpeg",
    attachment_size: 22,
    attachment_duration_sec: null,
    created_at: now,
    updated_at: now,
  };
  const conversation = {
    id: CONV_ID,
    coach_client_id: COACH_CLIENT_ID,
    coach_id: "coach-profile",
    client_id: "client-profile",
    created_at: now,
    updated_at: now,
    last_message_at: now,
  };
  return { message, conversation };
}

describe("POST /api/v1/messaging/conversations/:id/messages (media)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns 401 without a token", async () => {
    // Fields-only (no file body): with an unconsumed multipart file stream the
    // server may reset the connection instead of delivering the 401 JSON, so
    // the file-body 401 case is covered by the auth-matrix unit behavior.
    const res = await request(app)
      .post(`/api/v1/messaging/conversations/${CONV_ID}/messages`)
      .field("content", "hello");
    expect(res.status).toBe(401);
  });

  it("returns 400 for a malformed conversation id", async () => {
    const res = await request(app)
      .post("/api/v1/messaging/conversations/not-a-uuid/messages")
      .set("Authorization", `Bearer ${token("u1", "coach")}`)
      .attach("file", IMG);
    expect(res.status).toBe(400);
  });

  it("returns 400 for a disallowed file type and calls no service", async () => {
    const sendSpy = jest.spyOn(MessagingService.prototype, "sendMediaMessageToConversation");
    const res = await request(app)
      .post(`/api/v1/messaging/conversations/${CONV_ID}/messages`)
      .set("Authorization", `Bearer ${token("u1", "coach")}`)
      .attach("file", PDF);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("message_invalid_file_type");
    expect(res.body.details).toContain("message_invalid_file_type");
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("returns 413 for an oversize image with a type-specific key", async () => {
    const sendSpy = jest.spyOn(MessagingService.prototype, "sendMediaMessageToConversation");
    const big = Buffer.alloc(config.messaging.imageMaxBytes + 1, 0);
    const res = await request(app)
      .post(`/api/v1/messaging/conversations/${CONV_ID}/messages`)
      .set("Authorization", `Bearer ${token("u1", "coach")}`)
      .attach("file", big, { filename: "big.jpg", contentType: "image/jpeg" });
    expect(res.status).toBe(413);
    expect(res.body.details).toContain("image_too_large");
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("returns 400 for an overlong caption and calls no service", async () => {
    const sendSpy = jest.spyOn(MessagingService.prototype, "sendMediaMessageToConversation");
    const res = await request(app)
      .post(`/api/v1/messaging/conversations/${CONV_ID}/messages`)
      .set("Authorization", `Bearer ${token("u1", "coach")}`)
      .field("content", "a".repeat(config.messaging.maxContentLength + 1))
      .attach("file", IMG);
    expect(res.status).toBe(400);
    expect(res.body.details).toContain("message_content_too_long");
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("returns 400 attachment_required for multipart without a file", async () => {
    const sendSpy = jest.spyOn(MessagingService.prototype, "sendMediaMessageToConversation");
    const res = await request(app)
      .post(`/api/v1/messaging/conversations/${CONV_ID}/messages`)
      .set("Authorization", `Bearer ${token("u1", "coach")}`)
      .field("content", "caption without a file");
    expect(res.status).toBe(400);
    expect(res.body.details).toContain("attachment_required");
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("returns 201 with media fields for an image with caption", async () => {
    const sendSpy = jest
      .spyOn(MessagingService.prototype, "sendMediaMessageToConversation")
      .mockResolvedValue(fakeSendResult("Week 4 check-in") as never);
    const res = await request(app)
      .post(`/api/v1/messaging/conversations/${CONV_ID}/messages`)
      .set("Authorization", `Bearer ${token("coach-user", "coach")}`)
      .field("content", "Week 4 check-in")
      .attach("file", IMG);
    expect(res.status).toBe(201);
    expect(res.body.data.message.message_type).toBe("image");
    expect(res.body.data.message.attachment_url).toContain("https://");
    expect(res.body.data.message.attachment_mime).toBe("image/jpeg");
    expect(res.body.data.message.content).toBe("Week 4 check-in");
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it("returns 201 with null content for a caption-less image", async () => {
    jest
      .spyOn(MessagingService.prototype, "sendMediaMessageToConversation")
      .mockResolvedValue(fakeSendResult(null) as never);
    const res = await request(app)
      .post(`/api/v1/messaging/conversations/${CONV_ID}/messages`)
      .set("Authorization", `Bearer ${token("coach-user", "coach")}`)
      .attach("file", IMG);
    expect(res.status).toBe(201);
    expect(res.body.data.message.content).toBeNull();
  });

  it("rejects an unauthorized sender without creating anything (read-only check)", async () => {
    const res = await request(app)
      .post(`/api/v1/messaging/conversations/${CONV_ID}/messages`)
      .set("Authorization", `Bearer ${token("00000000-0000-4000-8000-000000000000", "coach")}`)
      .attach("file", IMG);
    expect([403, 404]).toContain(res.status);
  });
});

describe("POST /api/v1/messaging/conversations/by-coach-client/:id/messages (media)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns 201 for an image via the lazy-create route", async () => {
    const sendSpy = jest
      .spyOn(MessagingService.prototype, "sendMediaMessageByCoachClientId")
      .mockResolvedValue(fakeSendResult("hi") as never);
    const res = await request(app)
      .post(`/api/v1/messaging/conversations/by-coach-client/${COACH_CLIENT_ID}/messages`)
      .set("Authorization", `Bearer ${token("coach-user", "coach")}`)
      .field("content", "hi")
      .attach("file", IMG);
    expect(res.status).toBe(201);
    expect(res.body.data.message.message_type).toBe("image");
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it("returns 400 for a disallowed file type on the lazy-create route", async () => {
    const res = await request(app)
      .post(`/api/v1/messaging/conversations/by-coach-client/${COACH_CLIENT_ID}/messages`)
      .set("Authorization", `Bearer ${token("coach-user", "coach")}`)
      .attach("file", PDF);
    expect(res.status).toBe(400);
  });
});

describe("POST /api/v1/messaging/conversations/:id/messages (voice)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function fakeVoiceResult(durationSec: number | null) {
    const base = fakeSendResult("Today's cue");
    return {
      message: {
        ...base.message,
        message_type: "voice",
        attachment_url: "https://mock.cloudinary.com/video/upload/note.mp3",
        attachment_mime: "audio/mpeg",
        attachment_size: 74,
        attachment_duration_sec: durationSec,
      },
      conversation: base.conversation,
    };
  }

  it("returns 201 with voice fields when duration is provided", async () => {
    const sendSpy = jest
      .spyOn(MessagingService.prototype, "sendMediaMessageToConversation")
      .mockResolvedValue(fakeVoiceResult(187) as never);
    const res = await request(app)
      .post(`/api/v1/messaging/conversations/${CONV_ID}/messages`)
      .set("Authorization", `Bearer ${token("coach-user", "coach")}`)
      .field("message_type", "voice")
      .field("duration_sec", "187")
      .field("content", "Today's cue")
      .attach("file", MP3);
    expect(res.status).toBe(201);
    expect(res.body.data.message.message_type).toBe("voice");
    expect(res.body.data.message.attachment_url).toContain("https://");
    expect(res.body.data.message.attachment_mime).toBe("audio/mpeg");
    expect(res.body.data.message.attachment_duration_sec).toBe(187);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const validated = sendSpy.mock.calls[0][3] as { durationSec: number };
    expect(validated.durationSec).toBe(187);
  });

  it("returns 201 with null duration when omitted", async () => {
    jest
      .spyOn(MessagingService.prototype, "sendMediaMessageToConversation")
      .mockResolvedValue(fakeVoiceResult(null) as never);
    const res = await request(app)
      .post(`/api/v1/messaging/conversations/${CONV_ID}/messages`)
      .set("Authorization", `Bearer ${token("coach-user", "coach")}`)
      .attach("file", MP3);
    expect(res.status).toBe(201);
    expect(res.body.data.message.message_type).toBe("voice");
    expect(res.body.data.message.attachment_duration_sec).toBeNull();
  });

  it("returns 400 voice_too_long for over-limit duration", async () => {
    const sendSpy = jest.spyOn(MessagingService.prototype, "sendMediaMessageToConversation");
    const res = await request(app)
      .post(`/api/v1/messaging/conversations/${CONV_ID}/messages`)
      .set("Authorization", `Bearer ${token("coach-user", "coach")}`)
      .field("duration_sec", String(config.messaging.maxVoiceDurationSec + 1))
      .attach("file", MP3);
    expect(res.status).toBe(400);
    expect(res.body.details).toContain("voice_too_long");
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_duration for malformed duration", async () => {
    const res = await request(app)
      .post(`/api/v1/messaging/conversations/${CONV_ID}/messages`)
      .set("Authorization", `Bearer ${token("coach-user", "coach")}`)
      .field("duration_sec", "not-a-number")
      .attach("file", MP3);
    expect(res.status).toBe(400);
    expect(res.body.details).toContain("invalid_duration");
  });

  it("returns 400 invalid_message_type for mismatched explicit type", async () => {
    const res = await request(app)
      .post(`/api/v1/messaging/conversations/${CONV_ID}/messages`)
      .set("Authorization", `Bearer ${token("coach-user", "coach")}`)
      .field("message_type", "image")
      .attach("file", MP3);
    expect(res.status).toBe(400);
    expect(res.body.details).toContain("invalid_message_type");
  });

  it("returns 413 voice_too_large for oversize audio", async () => {
    const sendSpy = jest.spyOn(MessagingService.prototype, "sendMediaMessageToConversation");
    const big = Buffer.alloc(config.messaging.voiceMaxBytes + 1, 0);
    const res = await request(app)
      .post(`/api/v1/messaging/conversations/${CONV_ID}/messages`)
      .set("Authorization", `Bearer ${token("coach-user", "coach")}`)
      .attach("file", big, { filename: "note.mp3", contentType: "audio/mpeg" });
    expect(res.status).toBe(413);
    expect(res.body.details).toContain("voice_too_large");
    expect(sendSpy).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/messaging/conversations/:id/messages (text regression)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns 201 text shape with null attachment fields for JSON sends", async () => {
    const now = new Date();
    const sendSpy = jest
      .spyOn(MessagingService.prototype, "sendMessageToConversation")
      .mockResolvedValue({
        message: {
          id: MESSAGE_ID,
          conversation_id: CONV_ID,
          sender_user_id: "coach-user",
          sender_role: "coach",
          content: "hello",
          message_type: "text",
          attachment_url: null,
          attachment_mime: null,
          attachment_size: null,
          attachment_duration_sec: null,
          created_at: now,
          updated_at: now,
        },
        conversation: {
          id: CONV_ID,
          coach_client_id: COACH_CLIENT_ID,
          coach_id: "coach-profile",
          client_id: "client-profile",
          created_at: now,
          updated_at: now,
          last_message_at: now,
        },
      } as never);
    const res = await request(app)
      .post(`/api/v1/messaging/conversations/${CONV_ID}/messages`)
      .set("Authorization", `Bearer ${token("coach-user", "coach")}`)
      .send({ content: "hello" });
    expect(res.status).toBe(201);
    expect(res.body.data.message.message_type).toBe("text");
    expect(res.body.data.message.content).toBe("hello");
    expect(res.body.data.message.attachment_url).toBeNull();
    expect(res.body.data.message.attachment_mime).toBeNull();
    expect(res.body.data.message.attachment_size).toBeNull();
    expect(res.body.data.message.attachment_duration_sec).toBeNull();
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps existing JSON validation errors unchanged", async () => {
    const empty = await request(app)
      .post(`/api/v1/messaging/conversations/${CONV_ID}/messages`)
      .set("Authorization", `Bearer ${token("u1", "coach")}`)
      .send({ content: "   " });
    expect(empty.status).toBe(400);
    expect(empty.body.details).toContain("message_content_required");

    const tooLong = await request(app)
      .post(`/api/v1/messaging/conversations/${CONV_ID}/messages`)
      .set("Authorization", `Bearer ${token("u1", "coach")}`)
      .send({ content: "a".repeat(config.messaging.maxContentLength + 1) });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.details).toContain("message_content_too_long");
  });
});
