import "reflect-metadata";
import {
  buildConversationChannel,
  buildMessageCreatedPayload,
  publishMessageCreated,
} from "../../src/lib/ably";
import { config } from "../../src/config";

const CONV_ID = "123e4567-e89b-12d3-a456-426614174000";

describe("Ably publish payload mapping", () => {
  it("maps a message to a stable message.created event", () => {
    const createdAt = new Date("2026-09-23T12:00:00.000Z");
    const payload = buildMessageCreatedPayload({
      eventId: "e1",
      messageId: "m1",
      conversationId: CONV_ID,
      senderUserId: "u1",
      senderRole: "coach",
      content: "Hello",
      createdAt,
    });
    expect(payload.type).toBe("message.created");
    expect(payload.id).toBe("e1");
    expect(payload.payload.messageId).toBe("m1");
    expect(payload.payload.conversationId).toBe(CONV_ID);
    expect(payload.payload.content).toBe("Hello");
    expect(payload.payload.createdAt).toBe(createdAt.toISOString());
  });

  it("reuses the same event id on retries", () => {
    const createdAt = new Date();
    const a = buildMessageCreatedPayload({
      eventId: "stable-id",
      messageId: "m1",
      conversationId: CONV_ID,
      senderUserId: "u1",
      senderRole: "client",
      content: "Hi",
      createdAt,
    });
    const b = buildMessageCreatedPayload({
      eventId: "stable-id",
      messageId: "m1",
      conversationId: CONV_ID,
      senderUserId: "u1",
      senderRole: "client",
      content: "Hi",
      createdAt,
    });
    expect(a.id).toBe(b.id);
  });

  it("publishes to conversation:{id} with the message.created event name", async () => {
    const publish = jest.fn().mockResolvedValue(undefined);
    const fakeClient = {
      channels: { get: jest.fn().mockReturnValue({ publish }) },
    };
    const channel = buildConversationChannel(CONV_ID);
    const data = buildMessageCreatedPayload({
      eventId: "e1",
      messageId: "m1",
      conversationId: CONV_ID,
      senderUserId: "u1",
      senderRole: "coach",
      content: "Hello",
      createdAt: new Date(),
    });
    await publishMessageCreated(channel, data, fakeClient as never);
    expect(fakeClient.channels.get).toHaveBeenCalledWith(channel);
    expect(publish).toHaveBeenCalledWith(config.realtime.eventName, data);
  });

  it("carries image media fields in the message.created payload (US4)", () => {
    const createdAt = new Date("2026-09-30T10:00:00.000Z");
    const payload = buildMessageCreatedPayload({
      eventId: "e2",
      messageId: "m2",
      conversationId: CONV_ID,
      senderUserId: "u1",
      senderRole: "coach",
      content: "Form check",
      messageType: "image",
      attachmentUrl: "https://mock.cloudinary.com/image/upload/pic.jpg",
      attachmentMime: "image/jpeg",
      attachmentSize: 412800,
      attachmentDurationSec: null,
      createdAt,
    });
    expect(payload.payload.messageType).toBe("image");
    expect(payload.payload.attachmentUrl).toContain("https://");
    expect(payload.payload.attachmentMime).toBe("image/jpeg");
    expect(payload.payload.attachmentSize).toBe(412800);
    expect(payload.payload.attachmentDurationSec).toBeNull();
  });

  it("carries voice duration and nulls text attachments (US4)", () => {
    const createdAt = new Date("2026-09-30T10:00:00.000Z");
    const voice = buildMessageCreatedPayload({
      eventId: "e3",
      messageId: "m3",
      conversationId: CONV_ID,
      senderUserId: "u2",
      senderRole: "client",
      content: null,
      messageType: "voice",
      attachmentUrl: "https://mock.cloudinary.com/video/upload/note.mp3",
      attachmentMime: "audio/mpeg",
      attachmentSize: 1048576,
      attachmentDurationSec: 187,
      createdAt,
    });
    expect(voice.payload.attachmentDurationSec).toBe(187);
    expect(voice.payload.content).toBeNull();
    const text = buildMessageCreatedPayload({
      eventId: "e4",
      messageId: "m4",
      conversationId: CONV_ID,
      senderUserId: "u1",
      senderRole: "coach",
      content: "Hello",
      messageType: "text",
      createdAt,
    });
    expect(text.payload.messageType).toBe("text");
    expect(text.payload.attachmentUrl).toBeNull();
    expect(text.payload.attachmentMime).toBeNull();
    expect(text.payload.attachmentSize).toBeNull();
    expect(text.payload.attachmentDurationSec).toBeNull();
  });
});
