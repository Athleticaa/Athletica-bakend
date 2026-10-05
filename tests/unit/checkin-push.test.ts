import "reflect-metadata";
import { CheckInService } from "../../src/modules/checkin/checkin.service";

function makePush() {
  return { sendToUser: jest.fn().mockResolvedValue({ sent: 1 }) };
}

describe("CheckInService.assignCheckIn push", () => {
  it("notifies the client when a check-in is requested", async () => {
    const prisma = {
      coach_clients: {
        findFirst: jest.fn().mockResolvedValue({ id: "cc-1", client_id: "client-p1" }),
      },
      checkin_assignments: {
        upsert: jest.fn().mockResolvedValue({ id: "as-1", status: "pending" }),
      },
      coach_profiles: {
        findFirst: jest.fn().mockResolvedValue({
          user: { username: "CoachUser" },
        }),
      },
      client_profiles: {
        findFirst: jest.fn().mockResolvedValue({ user_id: "client-u1" }),
      },
    };
    const push = makePush();
    const svc = new CheckInService(prisma as never, push as never);

    const out = await svc.assignCheckIn("coach-p1", "cc-1");

    expect(out.id).toBe("as-1");
    expect(push.sendToUser).toHaveBeenCalledWith(
      "client-u1",
      expect.objectContaining({
        data: expect.objectContaining({ type: "checkin_requested", assignmentId: "as-1" }),
      }),
    );
  });
});

describe("CheckInService.submitCheckIn push", () => {
  it("notifies the coach when the client submits", async () => {
    const tx = {
      checkin_submissions: {
        create: jest.fn().mockResolvedValue({ id: "sub-1" }),
      },
      checkin_answers: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      checkin_assignments: {
        delete: jest.fn().mockResolvedValue({ id: "as-1" }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const prisma = {
      coach_clients: {
        findFirst: jest.fn().mockResolvedValue({ id: "cc-1", coach_id: "coach-p1" }),
      },
      checkin_assignments: {
        findFirst: jest.fn().mockResolvedValue({ id: "as-1", coach_client_id: "cc-1" }),
      },
      checkin_questions: {
        findMany: jest.fn().mockResolvedValue([
          { id: "q-1", required: true, type: "TEXT", options: [] },
        ]),
      },
      coach_profiles: {
        findFirst: jest.fn().mockResolvedValue({ user_id: "coach-u1" }),
      },
      client_profiles: {
        findFirst: jest.fn().mockResolvedValue({ user: { username: "ClientUser" } }),
      },
      $transaction: jest.fn().mockImplementation((cb: (t: unknown) => unknown) => cb(tx)),
    };
    const push = makePush();
    const svc = new CheckInService(prisma as never, push as never);

    const out = await svc.submitCheckIn(
      "client-p1",
      [{ question_id: "q-1", answer_value: "feeling good" }],
      {},
    );

    expect(out.id).toBe("sub-1");
    expect(push.sendToUser).toHaveBeenCalledWith(
      "coach-u1",
      expect.objectContaining({
        data: expect.objectContaining({ type: "checkin_submitted", submissionId: "sub-1" }),
      }),
    );
  });
});
