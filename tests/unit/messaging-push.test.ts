import "reflect-metadata";
import { MessagingService } from "../../src/modules/messaging/messaging.service";
import { resetAblyClient, setAblyRestClient } from "../../src/lib/ably";

const MESSAGE = {
  id: "m1",
  conversation_id: "c1",
  sender_user_id: "coach-user-1",
  sender_role: "coach",
  content: "hello client",
  message_type: "text",
};

function makePrisma() {
  return {
    conversations: {
      findUnique: jest.fn().mockResolvedValue({
        coach: { user: { id: "coach-user-1" } },
        client: { user: { id: "client-user-1" } },
      }),
    },
    users: {
      findUnique: jest.fn().mockResolvedValue({ username: "Coach" }),
    },
  };
}

function makeAbly(items: Array<{ clientId: string }>) {
  const presenceGet = jest.fn().mockResolvedValue({ items });
  setAblyRestClient({
    channels: {
      get: jest.fn().mockReturnValue({ presence: { get: presenceGet } }),
    },
  } as never);
  return presenceGet;
}

afterEach(() => {
  resetAblyClient();
});

describe("MessagingService recipient push (presence-gated)", () => {
  it("skips FCM when the recipient is present in the Ably channel", async () => {
    const presenceGet = makeAbly([{ clientId: "client-user-1" }]);
    const push = { sendToUser: jest.fn() };
    const svc = new MessagingService(makePrisma() as never, push as never);
    await (svc as unknown as { notifyRecipient: (c: string, m: unknown) => Promise<void> }).notifyRecipient(
      "conversation:c1",
      MESSAGE,
    );
    expect(presenceGet).toHaveBeenCalledWith({ clientId: "client-user-1" });
    expect(push.sendToUser).not.toHaveBeenCalled();
  });

  it("sends FCM when the recipient is absent", async () => {
    makeAbly([]);
    const push = { sendToUser: jest.fn().mockResolvedValue({ sent: 1 }) };
    const svc = new MessagingService(makePrisma() as never, push as never);
    await (svc as unknown as { notifyRecipient: (c: string, m: unknown) => Promise<void> }).notifyRecipient(
      "conversation:c1",
      MESSAGE,
    );
    expect(push.sendToUser).toHaveBeenCalledWith(
      "client-user-1",
      expect.objectContaining({
        data: expect.objectContaining({
          type: "chat_message",
          conversationId: "c1",
          messageId: "m1",
        }),
      }),
    );
  });

  it("does nothing when PushService is not wired (legacy construction)", async () => {
    const svc = new MessagingService(makePrisma() as never);
    await expect(
      (svc as unknown as { notifyRecipient: (c: string, m: unknown) => Promise<void> }).notifyRecipient(
        "conversation:c1",
        MESSAGE,
      ),
    ).resolves.toBeUndefined();
  });
});
