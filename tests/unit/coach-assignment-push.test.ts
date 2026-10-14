import "reflect-metadata";
import { CoachAssignmentService } from "../../src/modules/coach-assignment/coach-assignment.service";

function makePush() {
  return { sendToUser: jest.fn().mockResolvedValue({ sent: 1 }) };
}

describe("CoachAssignmentService push hooks", () => {
  it("notifies the coach when a client submits a request", async () => {
    const prisma = {
      coach_profiles: {
        findFirst: jest.fn().mockResolvedValue({
          id: "coach-p1",
          user_id: "coach-u1",
          profile_image: null,
        }),
      },
      client_profiles: {
        findFirst: jest.fn().mockResolvedValue({ id: "client-p1" }),
      },
      coach_clients: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      coach_requests: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: "req-1",
          coach_id: "coach-p1",
          client_id: "client-p1",
          status: "pending",
        }),
      },
      users: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ username: "ClientUser", email: "c@test.com" }),
      },
    };
    const push = makePush();
    const svc = new CoachAssignmentService(
      prisma as never,
      {} as never,
      push as never,
    );

    const out = await svc.submitRequest("client-u1", "ABC123");

    expect(out.record.id).toBe("req-1");
    expect(push.sendToUser).toHaveBeenCalledWith(
      "coach-u1",
      expect.objectContaining({
        data: expect.objectContaining({ type: "coach_request", requestId: "req-1" }),
      }),
    );
  });

  it("notifies the client when the coach accepts", async () => {
    const tx = {
      coach_clients: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: "cc-1",
          coach_id: "coach-p1",
          client_id: "client-p1",
        }),
      },
      coach_requests: {
        update: jest.fn().mockResolvedValue({ id: "req-1", status: "accepted" }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const prisma = {
      coach_profiles: {
        findFirst: jest.fn().mockResolvedValue({ id: "coach-p1" }),
      },
      coach_requests: {
        findFirst: jest.fn().mockResolvedValue({
          id: "req-1",
          coach_id: "coach-p1",
          client_id: "client-p1",
          status: "pending",
        }),
      },
      client_profiles: {
        findFirst: jest.fn().mockResolvedValue({ user_id: "client-u1" }),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      users: {
        findUnique: jest.fn().mockResolvedValue({ username: "CoachUser" }),
      },
      $transaction: jest.fn().mockImplementation((cb: (t: unknown) => unknown) => cb(tx)),
    };
    const push = makePush();
    const svc = new CoachAssignmentService(
      prisma as never,
      {} as never,
      push as never,
    );

    const out = await svc.acceptRequest("coach-u1", "req-1");

    expect(out.assignment.id).toBe("cc-1");
    expect(push.sendToUser).toHaveBeenCalledWith(
      "client-u1",
      expect.objectContaining({
        data: expect.objectContaining({ type: "request_accepted", assignmentId: "cc-1" }),
      }),
    );
  });

  it("sends no push when PushService is not wired", async () => {
    const prisma = {
      coach_profiles: {
        findFirst: jest.fn().mockResolvedValue({
          id: "coach-p1",
          user_id: "coach-u1",
          profile_image: null,
        }),
      },
      client_profiles: {
        findFirst: jest.fn().mockResolvedValue({ id: "client-p1" }),
      },
      coach_clients: { findFirst: jest.fn().mockResolvedValue(null) },
      coach_requests: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: "req-1",
          coach_id: "coach-p1",
          client_id: "client-p1",
          status: "pending",
        }),
      },
      users: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ username: "ClientUser", email: "c@test.com" }),
      },
    };
    const svc = new CoachAssignmentService(prisma as never, {} as never);
    await expect(svc.submitRequest("client-u1", "ABC123")).resolves.toBeDefined();
  });
});
