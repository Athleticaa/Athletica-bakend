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
});
