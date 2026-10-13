import "reflect-metadata";
import { PushService } from "../../src/services/push";
import { setMessagingForTests } from "../../src/lib/firebase";

function makePrisma(devices: Array<{ fcm_token: string }>) {
  const updates: Array<{ where: unknown; data: unknown }> = [];
  const prisma = {
    user_devices: {
      findMany: jest.fn().mockResolvedValue(devices),
      updateMany: jest
        .fn()
        .mockImplementation(
          ({ where, data }: { where: unknown; data: Record<string, unknown> }) => {
            updates.push({ where, data });
            return Promise.resolve({ count: 1 });
          },
        ),
    },
  };
  return { prisma, updates };
}

const NOTIF = {
  title: "Test",
  body: "Body",
  data: { type: "chat_message", conversationId: "c1" },
};

afterEach(() => {
  setMessagingForTests(undefined);
});

describe("PushService.sendToUser", () => {
  it("returns early when user has no active devices", async () => {
    const sendEachForMulticast = jest.fn();
    setMessagingForTests({ sendEachForMulticast } as never);
    const { prisma } = makePrisma([]);
    const svc = new PushService(prisma as never);
    const result = await svc.sendToUser("u1", NOTIF);
    expect(result.sent).toBe(0);
    expect(result.skipped).toBe(false);
    expect(sendEachForMulticast).not.toHaveBeenCalled();
  });

  it("sends to all active devices", async () => {
    const sendEachForMulticast = jest.fn().mockResolvedValue({
      successCount: 2,
      responses: [{ success: true }, { success: true }],
    });
    setMessagingForTests({ sendEachForMulticast } as never);
    const { prisma } = makePrisma([{ fcm_token: "tok1" }, { fcm_token: "tok2" }]);
    const svc = new PushService(prisma as never);
    const result = await svc.sendToUser("u1", NOTIF);
    expect(result.sent).toBe(2);
    expect(sendEachForMulticast).toHaveBeenCalledWith(
      expect.objectContaining({ tokens: ["tok1", "tok2"] }),
    );
  });

  it("deactivates unregistered tokens", async () => {
    const sendEachForMulticast = jest.fn().mockResolvedValue({
      successCount: 1,
      responses: [
        { success: true },
        {
          success: false,
          error: { code: "messaging/registration-token-not-registered" },
        },
      ],
    });
    setMessagingForTests({ sendEachForMulticast } as never);
    const { prisma, updates } = makePrisma([
      { fcm_token: "tok1" },
      { fcm_token: "tok2" },
    ]);
    const svc = new PushService(prisma as never);
    const result = await svc.sendToUser("u1", NOTIF);
    expect(result.deactivated).toBe(1);
    expect(updates).toHaveLength(1);
    expect(updates[0].where).toEqual({ fcm_token: "tok2", user_id: "u1" });
    expect(updates[0].data).toEqual({ is_active: false });
  });

  it("returns skipped when firebase is not configured", async () => {
    setMessagingForTests(null);
    const { prisma } = makePrisma([{ fcm_token: "tok1" }]);
    const svc = new PushService(prisma as never);
    const result = await svc.sendToUser("u1", NOTIF);
    expect(result.skipped).toBe(true);
    expect(result.sent).toBe(0);
  });

  it("skips the send (zeros, no throw) when the device lookup fails", async () => {
    const sendEachForMulticast = jest.fn();
    setMessagingForTests({ sendEachForMulticast } as never);
    const prisma = {
      user_devices: {
        findMany: jest.fn().mockRejectedValue(new Error("db slow")),
        updateMany: jest.fn(),
      },
    };
    const svc = new PushService(prisma as never);
    const result = await svc.sendToUser("u1", NOTIF);
    expect(result).toEqual({ sent: 0, deactivated: 0, skipped: false });
    expect(sendEachForMulticast).not.toHaveBeenCalled();
  });
});
