import "reflect-metadata";
import { NotificationsService } from "../../src/modules/notifications/notifications.service";
import {
  encodeNotificationCursor,
  parseNotificationListQuery,
} from "../../src/modules/notifications/notifications.validation";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    recipient_user_id: "u1",
    type: "workout_assigned",
    title: "New workout plan",
    body: "Coach assigned you a plan",
    data: {
      type: "workout_assigned",
      planId: "wp-1",
      actorUserId: "coach-u1",
      actorUsername: "CoachUser",
      actorProfileImage: "https://img/coach.png",
      actorRole: "coach",
    },
    is_read: false,
    read_at: null,
    created_at: new Date("2026-10-02T10:00:00.000Z"),
    ...overrides,
  };
}

function userMocks(role: string = "client") {
  return {
    users: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: "u1", username: "TestUser", role }),
    },
    coach_profiles: {
      findFirst: jest.fn().mockResolvedValue({ profile_image: "https://img/coach.png" }),
    },
    client_profiles: {
      findFirst: jest.fn().mockResolvedValue({ profile_image: "https://img/client.png" }),
    },
  };
}

describe("NotificationsService.create", () => {
  it("persists title/body/data snapshot for the recipient with recipient profile", async () => {
    const created = row();
    const prisma = {
      notifications: { create: jest.fn().mockResolvedValue(created) },
      ...userMocks(),
    };
    const svc = new NotificationsService(prisma as never);
    const out = await svc.create("u1", {
      type: "workout_assigned",
      title: "New workout plan",
      body: "Body",
      data: { type: "workout_assigned", planId: "wp-1" },
    });
    expect(prisma.notifications.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        recipient_user_id: "u1",
        type: "workout_assigned",
      }),
    });
    expect(out.id).toBe(created.id);
    expect(out.is_read).toBe(false);
    expect(out.recipient).toEqual({
      id: "u1",
      username: "TestUser",
      profile_image: "https://img/client.png",
      role: "client",
    });
    expect(out.actor).toEqual({
      user_id: "coach-u1",
      username: "CoachUser",
      profile_image: "https://img/coach.png",
      role: "coach",
    });
  });

  it("rejects unknown types", async () => {
    const prisma = { notifications: { create: jest.fn() } };
    const svc = new NotificationsService(prisma as never);
    await expect(
      svc.create("u1", { type: "chat_message", title: "t", body: "b" } as never),
    ).rejects.toMatchObject({ messageKey: "invalid_notification_type" });
    expect(prisma.notifications.create).not.toHaveBeenCalled();
  });
});

describe("NotificationsService.list", () => {
  it("pages newest-first with cursor and hasMore", async () => {
    const newest = row({ id: "22222222-2222-4222-8222-222222222222" });
    const oldest = row({ id: "11111111-1111-4111-8111-111111111111" });
    const prisma = {
      notifications: {
        findMany: jest.fn().mockResolvedValue([newest, oldest, row({})]),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      ...userMocks(),
    };
    const svc = new NotificationsService(prisma as never);
    const out = await svc.list("u1", { limit: 2, unreadOnly: false });
    expect(out.notifications).toHaveLength(2);
    expect(out.hasMore).toBe(true);
    expect(out.nextCursor).toBeDefined();
    expect(prisma.notifications.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ recipient_user_id: "u1" }),
        take: 3,
      }),
    );
    expect(out.notifications[0].recipient?.username).toBe("TestUser");
    expect(out.notifications[0].actor?.username).toBe("CoachUser");
  });

  it("marks only the returned page read on open (later pages survive)", async () => {
    const pageRow = row({ id: "22222222-2222-4222-8222-222222222222" });
    const prisma = {
      notifications: {
        findMany: jest.fn().mockResolvedValue([pageRow, row({})]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      ...userMocks(),
    };
    const svc = new NotificationsService(prisma as never);
    const out = await svc.list("u1", { limit: 1, unreadOnly: true });
    expect(out.notifications).toHaveLength(1);
    // Scoped to the returned page ID — unseen rows stay unread for page 2.
    expect(prisma.notifications.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["22222222-2222-4222-8222-222222222222"] },
        recipient_user_id: "u1",
        is_read: false,
      },
      data: expect.objectContaining({ is_read: true }),
    });
    expect(out.notifications[0].is_read).toBe(true);
    expect(out.notifications[0].read_at).not.toBeNull();
  });

  it("skips the mark entirely with auto_read=false (side-effect-free poll)", async () => {
    const prisma = {
      notifications: {
        findMany: jest.fn().mockResolvedValue([row()]),
        updateMany: jest.fn(),
      },
      ...userMocks(),
    };
    const svc = new NotificationsService(prisma as never);
    const out = await svc.list("u1", { limit: 20, unreadOnly: false, autoRead: false });
    expect(out.notifications).toHaveLength(1);
    expect(out.notifications[0].is_read).toBe(false);
    expect(prisma.notifications.updateMany).not.toHaveBeenCalled();
  });

  it("still returns the page when the auto read fails", async () => {
    const prisma = {
      notifications: {
        findMany: jest.fn().mockResolvedValue([row()]),
        updateMany: jest.fn().mockRejectedValue(new Error("db down")),
      },
      ...userMocks(),
    };
    const svc = new NotificationsService(prisma as never);
    const out = await svc.list("u1", { limit: 20, unreadOnly: false });
    expect(out.notifications).toHaveLength(1);
    expect(out.notifications[0].is_read).toBe(false);
  });

  it("filters unread only when requested", async () => {
    const prisma = {
      notifications: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn(),
      },
      ...userMocks(),
    };
    const svc = new NotificationsService(prisma as never);
    await svc.list("u1", { limit: 20, unreadOnly: true });
    expect(prisma.notifications.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ is_read: false }),
      }),
    );
    expect(prisma.notifications.updateMany).not.toHaveBeenCalled();
  });

  it("applies a before cursor", async () => {
    const prisma = {
      notifications: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn(),
      },
      ...userMocks(),
    };
    const svc = new NotificationsService(prisma as never);
    const before = {
      createdAt: new Date("2026-10-02T10:00:00.000Z"),
      id: "33333333-3333-4333-8333-333333333333",
    };
    await svc.list("u1", { limit: 20, unreadOnly: false, before });
    expect(prisma.notifications.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ OR: expect.any(Array) }),
      }),
    );
  });
});

describe("NotificationsService read state", () => {
  it("unreadCount scopes to the recipient", async () => {
    const prisma = { notifications: { count: jest.fn().mockResolvedValue(3) } };
    const svc = new NotificationsService(prisma as never);
    await expect(svc.unreadCount("u1")).resolves.toBe(3);
    expect(prisma.notifications.count).toHaveBeenCalledWith({
      where: { recipient_user_id: "u1", is_read: false },
    });
  });

  it("markRead flips an unread row and enriches it", async () => {
    const updated = row({ is_read: true, read_at: new Date() });
    const prisma = {
      notifications: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue(updated),
      },
      ...userMocks(),
    };
    const svc = new NotificationsService(prisma as never);
    const out = await svc.markRead("u1", updated.id);
    expect(out.is_read).toBe(true);
    expect(out.recipient?.username).toBe("TestUser");
    expect(out.actor?.username).toBe("CoachUser");
    expect(prisma.notifications.updateMany).toHaveBeenCalledWith({
      where: { id: updated.id, recipient_user_id: "u1", is_read: false },
      data: expect.objectContaining({ is_read: true }),
    });
  });

  it("markRead is idempotent for an already-read row", async () => {
    const existing = row({ is_read: true });
    const prisma = {
      notifications: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findFirst: jest.fn().mockResolvedValue(existing),
      },
      ...userMocks(),
    };
    const svc = new NotificationsService(prisma as never);
    const out = await svc.markRead("u1", existing.id);
    expect(out.is_read).toBe(true);
  });

  it("markRead 404s for another user's notification", async () => {
    const prisma = {
      notifications: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      ...userMocks(),
    };
    const svc = new NotificationsService(prisma as never);
    await expect(
      svc.markRead("u1", "99999999-9999-4999-8999-999999999999"),
    ).rejects.toMatchObject({ messageKey: "notification_not_found", statusCode: 404 });
  });

  it("markAllRead only touches the caller's unread rows", async () => {
    const prisma = {
      notifications: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
    };
    const svc = new NotificationsService(prisma as never);
    await expect(svc.markAllRead("u1")).resolves.toEqual({ updated: 2 });
    expect(prisma.notifications.updateMany).toHaveBeenCalledWith({
      where: { recipient_user_id: "u1", is_read: false },
      data: expect.objectContaining({ is_read: true }),
    });
  });
});

describe("notifications validation", () => {
  it("accepts limit/cursor/unread_only", () => {
    const cursor = encodeNotificationCursor({
      createdAt: new Date("2026-10-02T10:00:00.000Z"),
      id: "11111111-1111-4111-8111-111111111111",
    });
    const { result, errors } = parseNotificationListQuery({
      limit: "20",
      before: cursor,
      unread_only: "true",
    });
    expect(errors).toHaveLength(0);
    expect(result?.limit).toBe(20);
    expect(result?.unreadOnly).toBe(true);
  });

  it("rejects bad limit and cursor", async () => {
    const { errors } = parseNotificationListQuery({ limit: "999", before: "nope" });
    expect(errors).toContain("invalid_limit");
    expect(errors).toContain("invalid_cursor");
  });

  it("parses auto_read opt-out and rejects garbage", () => {
    const { result, errors } = parseNotificationListQuery({ auto_read: "false" });
    expect(errors).toHaveLength(0);
    expect(result?.autoRead).toBe(false);
    const bad = parseNotificationListQuery({ auto_read: "maybe" });
    expect(bad.errors).toContain("invalid_auto_read");
  });
});
