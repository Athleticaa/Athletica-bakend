import jwt from "jsonwebtoken";
import request from "supertest";
import app from "../../src/app";
import { MessagingService } from "../../src/modules/messaging/messaging.service";

const SECRET = process.env.JWT_SECRET || "change-me-to-a-random-secret-in-production";
const CONV_ID = "123e4567-e89b-12d3-a456-426614174000";

function token(sub: string, role: string) {
  return jwt.sign({ sub, email: `${sub}@test.com`, role }, SECRET, { expiresIn: "1h" });
}

const now = new Date("2026-09-30T10:00:00.000Z");

function mediaMessage() {
  return {
    id: "323e4567-e89b-12d3-a456-426614174000",
    conversation_id: CONV_ID,
    sender_user_id: "coach-user",
    sender_role: "coach",
    content: "Form check",
    message_type: "image",
    attachment_url: "https://mock.cloudinary.com/image/upload/pic.jpg",
    attachment_mime: "image/jpeg",
    attachment_size: 412800,
    attachment_duration_sec: null,
    created_at: now,
    updated_at: now,
  };
}

function textMessage() {
  return {
    ...mediaMessage(),
    id: "423e4567-e89b-12d3-a456-426614174000",
    content: "hello",
    message_type: "text",
    attachment_url: null,
    attachment_mime: null,
    attachment_size: null,
    attachment_duration_sec: null,
  };
}

function conversationRow() {
  return {
    id: CONV_ID,
    coach_client_id: "223e4567-e89b-12d3-a456-426614174000",
    coach_id: "coach-profile",
    client_id: "client-profile",
    created_at: now,
    updated_at: now,
    last_message_at: now,
    counterpart: { role: "client", id: "client-profile", username: "client1", profile_image: null },
    last_message: mediaMessage(),
  };
}

describe("GET message history with media (US4)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns media fields on image messages and nulls on text", async () => {
    jest
      .spyOn(MessagingService.prototype, "getMessageHistory")
      .mockResolvedValue({ messages: [textMessage(), mediaMessage()] as never, nextCursor: undefined, hasMore: false });
    const res = await request(app)
      .get(`/api/v1/messaging/conversations/${CONV_ID}/messages`)
      .set("Authorization", `Bearer ${token("coach-user", "coach")}`);
    expect(res.status).toBe(200);
    const [text, image] = res.body.data.messages;
    expect(image.message_type).toBe("image");
    expect(image.attachment_url).toContain("https://");
    expect(image.attachment_mime).toBe("image/jpeg");
    expect(image.attachment_size).toBe(412800);
    expect(image.attachment_duration_sec).toBeNull();
    expect(text.message_type).toBe("text");
    expect(text.attachment_url).toBeNull();
    expect(res.body.data.hasMore).toBe(false);
  });
});

describe("GET conversations with media last_message (US4)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("embeds media fields in list last_message", async () => {
    jest
      .spyOn(MessagingService.prototype, "listConversations")
      .mockResolvedValue({ conversations: [conversationRow()] as never });
    const res = await request(app)
      .get("/api/v1/messaging/conversations")
      .set("Authorization", `Bearer ${token("coach-user", "coach")}`);
    expect(res.status).toBe(200);
    const last = res.body.data.conversations[0].last_message;
    expect(last.message_type).toBe("image");
    expect(last.attachment_url).toContain("https://");
    expect(last.attachment_mime).toBe("image/jpeg");
  });

  it("embeds media fields in single-conversation last_message", async () => {
    jest
      .spyOn(MessagingService.prototype, "getConversation")
      .mockResolvedValue({ conversation: conversationRow() as never });
    const res = await request(app)
      .get(`/api/v1/messaging/conversations/${CONV_ID}`)
      .set("Authorization", `Bearer ${token("coach-user", "coach")}`);
    expect(res.status).toBe(200);
    expect(res.body.data.conversation.last_message.message_type).toBe("image");
    expect(res.body.data.conversation.last_message.attachment_url).toContain("https://");
  });
});
