import "reflect-metadata";
import { Prisma } from "@prisma/client";
import { CoachAssignmentService } from "../../src/modules/coach-assignment/coach-assignment.service";
import { ServiceError } from "../../src/lib/service-error";

const mockPrisma = {
  coach_profiles: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  client_profiles: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
  },
  client_answers: {
    findMany: jest.fn(),
  },
  client_questions: {
    findMany: jest.fn(),
    count: jest.fn(),
  },
  nutrition_plans: {
    findFirst: jest.fn(),
  },
  workout_plans: {
    findFirst: jest.fn(),
  },
  coach_requests: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    create: jest.fn(),
  },
  coach_clients: {
    findFirst: jest.fn(),
    create: jest.fn(),
    deleteMany: jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockJwt = {
  signInviteToken: jest.fn(),
  verifyInviteToken: jest.fn(),
};

const INVALID_OR_EXPIRED = "invalid_or_expired_token";

function p2002() {
  return new Prisma.PrismaClientKnownRequestError("unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { target: ["client_id"] },
  });
}

function getService(): CoachAssignmentService {
  return new CoachAssignmentService(mockPrisma as any, mockJwt as any);
}

function expectServiceError(promise: Promise<unknown>, key: string, statusCode: number) {
  return promise.then(
    () => {
      throw new Error("expected ServiceError to be thrown");
    },
    (err) => {
      expect(err).toBeInstanceOf(ServiceError);
      expect((err as ServiceError).messageKey).toBe(key);
      expect((err as ServiceError).statusCode).toBe(statusCode);
    }
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("CoachAssignmentService.generateInvite", () => {
  it("returns a new token on first call", async () => {
    mockPrisma.coach_profiles.findFirst
      .mockResolvedValueOnce({
        id: "coach-1",
        active_invite_code: null,
        active_invite_code_expires_at: null,
      })
      .mockResolvedValueOnce(null); // existing code lookup
    mockJwt.signInviteToken.mockReturnValue("token-abc");

    const service = getService();
    const result = await service.generateInvite("user-1");

    expect(result.token).toBeDefined(); // token is still returned for compat
    expect(result.code).toBeDefined();
    expect(result.reused).toBe(false);
    expect(mockPrisma.coach_profiles.update).toHaveBeenCalledWith({
      where: { id: "coach-1" },
      data: {
        active_invite_code: expect.any(String),
        active_invite_code_expires_at: expect.any(Date),
      },
    });
  });

  it("returns the SAME token when an unexpired one exists (idempotent)", async () => {
    mockPrisma.coach_profiles.findFirst.mockResolvedValue({
      id: "coach-1",
      active_invite_code: "EXISTING",
      active_invite_code_expires_at: new Date(Date.now() + 60 * 60 * 1000),
    });

    const service = getService();
    const result = await service.generateInvite("user-1");

    expect(result.token).toBe("EXISTING");
    expect(result.code).toBe("EXISTING");
    expect(result.reused).toBe(true);
    expect(mockPrisma.coach_profiles.update).not.toHaveBeenCalled();
  });

  it("throws 404 when the user has no coach profile", async () => {
    mockPrisma.coach_profiles.findFirst.mockResolvedValue(null);

    const service = getService();
    await expectServiceError(service.generateInvite("user-1"), "coach_profile_not_found", 404);
  });
});

describe("CoachAssignmentService.submitRequest", () => {
  const coachProfile = {
    id: "coach-1",
    user_id: "coach-user",
    active_invite_code: "VALIDC",
    active_invite_code_expires_at: new Date(Date.now() + 60 * 60 * 1000),
  };

  beforeEach(() => {
    mockPrisma.coach_profiles.findFirst.mockResolvedValue(coachProfile);
    mockPrisma.client_profiles.findFirst.mockResolvedValue({ id: "client-1" });
    mockPrisma.coach_clients.findFirst.mockResolvedValue(null);
    mockPrisma.coach_requests.findUnique.mockResolvedValue(null);
  });

  it("throws 400 for invalid/expired token", async () => {
    mockPrisma.coach_profiles.findFirst.mockResolvedValue(null);

    const service = getService();
    await expectServiceError(
      service.submitRequest("client-user", "BADCOD"),
      "invalid_or_expired_code",
      400
    );
  });

  it("throws 400 when the stored token does not match (not found)", async () => {
    mockPrisma.coach_profiles.findFirst.mockResolvedValue(null);

    const service = getService();
    await expectServiceError(
      service.submitRequest("client-user", "VALIDC"),
      "invalid_or_expired_code",
      400
    );
  });

  it("throws 400 on self-assignment", async () => {
    const service = getService();
    await expectServiceError(service.submitRequest("coach-user", "VALIDC"), "cannot_assign_self", 400);
  });

  it("throws 400 when the client already has a coach", async () => {
    mockPrisma.coach_clients.findFirst.mockResolvedValue({ id: "assignment-1" });

    const service = getService();
    await expectServiceError(service.submitRequest("client-user", "VALIDC"), "already_have_coach", 400);
  });

  it("throws 409 on duplicate pending request", async () => {
    mockPrisma.coach_requests.findUnique.mockResolvedValue({ id: "req-1", status: "pending" });

    const service = getService();
    await expectServiceError(service.submitRequest("client-user", "VALIDC"), "request_already_exists", 409);
  });

  it("throws 400 when resubmitting within 5 minutes of rejection", async () => {
    mockPrisma.coach_requests.findUnique.mockResolvedValue({
      id: "req-1",
      status: "rejected",
      rejected_at: new Date(Date.now() - 60 * 1000),
    });

    const service = getService();
    await expectServiceError(service.submitRequest("client-user", "VALIDC"), "wait_before_resubmit", 400);
  });

  it("resets a rejected request after 5 minutes (200)", async () => {
    mockPrisma.coach_requests.findUnique.mockResolvedValue({
      id: "req-1",
      status: "rejected",
      rejected_at: new Date(Date.now() - 6 * 60 * 1000),
    });
    mockPrisma.coach_requests.update.mockResolvedValue({
      id: "req-1",
      status: "pending",
      rejected_at: null,
    });

    const service = getService();
    const result = await service.submitRequest("client-user", "VALIDC");

    expect(result.created).toBe(false);
    expect(mockPrisma.coach_requests.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "pending", rejected_at: null } })
    );
  });

  it("resets an accepted request after client left (200)", async () => {
    mockPrisma.coach_requests.findUnique.mockResolvedValue({
      id: "req-1",
      status: "accepted",
      rejected_at: null,
    });
    mockPrisma.coach_clients.findFirst.mockResolvedValue(null);
    mockPrisma.coach_requests.update.mockResolvedValue({
      id: "req-1",
      status: "pending",
      rejected_at: null,
    });

    const service = getService();
    const result = await service.submitRequest("client-user", "VALIDC");

    expect(result.created).toBe(false);
    expect(mockPrisma.coach_requests.update).toHaveBeenCalled();
  });

  it("creates a new pending request (201)", async () => {
    mockPrisma.coach_requests.create.mockResolvedValue({
      id: "req-new",
      status: "pending",
      coach_id: "coach-1",
      client_id: "client-1",
    });

    const service = getService();
    const result = await service.submitRequest("client-user", "VALIDC");

    expect(result.created).toBe(true);
    expect(mockPrisma.coach_requests.create).toHaveBeenCalledWith({
      data: { coach_id: "coach-1", client_id: "client-1", status: "pending" },
    });
  });

  it("throws 404 when the client profile does not exist", async () => {
    mockPrisma.client_profiles.findFirst.mockResolvedValue(null);

    const service = getService();
    await expectServiceError(service.submitRequest("client-user", "VALIDC"), "client_profile_not_found", 404);
  });

  it("maps a unique-violation race on create to 409", async () => {
    mockPrisma.coach_requests.create.mockRejectedValue(p2002());

    const service = getService();
    await expectServiceError(service.submitRequest("client-user", "VALIDC"), "request_already_exists", 409);
  });
});

describe("CoachAssignmentService.acceptRequest", () => {
  const request = {
    id: "req-1",
    coach_id: "coach-1",
    client_id: "client-1",
    status: "pending",
  };

  beforeEach(() => {
    mockPrisma.coach_profiles.findFirst.mockResolvedValue({ id: "coach-1", user_id: "coach-user" });
    mockPrisma.$transaction.mockImplementation((cb: (tx: any) => unknown) => cb(mockPrisma));
  });

  it("accepts a pending request and creates the assignment (200)", async () => {
    mockPrisma.coach_requests.findFirst.mockResolvedValue(request);
    mockPrisma.coach_clients.findFirst.mockResolvedValue(null);
    mockPrisma.coach_requests.update.mockResolvedValue({ id: "req-1", status: "accepted" });
    mockPrisma.coach_clients.create.mockResolvedValue({
      id: "assign-1",
      coach_id: "coach-1",
      client_id: "client-1",
    });

    const service = getService();
    const result = await service.acceptRequest("coach-user", "req-1");

    expect(result.assignment.id).toBe("assign-1");
    expect(mockPrisma.coach_requests.update).toHaveBeenCalledWith({
      where: { id: "req-1" },
      data: { status: "accepted" },
    });
    expect(mockPrisma.coach_clients.create).toHaveBeenCalledWith({
      data: { coach_id: "coach-1", client_id: "client-1" },
    });
    expect(mockPrisma.coach_requests.updateMany).toHaveBeenCalledWith({
      where: { client_id: "client-1", coach_id: { not: "coach-1" }, status: "pending" },
      data: { status: "rejected", rejected_at: expect.any(Date) },
    });
  });

  it("throws 400 when the client already has a different coach", async () => {
    mockPrisma.coach_requests.findFirst.mockResolvedValue(request);
    mockPrisma.coach_clients.findFirst.mockResolvedValue({
      id: "assign-other",
      coach_id: "coach-2",
      client_id: "client-1",
    });

    const service = getService();
    await expectServiceError(service.acceptRequest("coach-user", "req-1"), "already_have_coach", 400);
    expect(mockPrisma.coach_clients.create).not.toHaveBeenCalled();
    expect(mockPrisma.coach_requests.updateMany).not.toHaveBeenCalled();
  });

  it("maps a unique-violation race on create to 400 when the same request already won", async () => {
    mockPrisma.coach_requests.findFirst.mockResolvedValue(request);
    mockPrisma.coach_clients.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "assign-1", coach_id: "coach-1", client_id: "client-1" });
    mockPrisma.coach_clients.create.mockRejectedValue(p2002());

    const service = getService();
    await expectServiceError(service.acceptRequest("coach-user", "req-1"), "request_not_pending", 400);
  });

  it("maps a unique-violation race on create to 400 when a different coach won", async () => {
    mockPrisma.coach_requests.findFirst.mockResolvedValue(request);
    mockPrisma.coach_clients.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "assign-other", coach_id: "coach-2", client_id: "client-1" });
    mockPrisma.coach_clients.create.mockRejectedValue(p2002());

    const service = getService();
    await expectServiceError(service.acceptRequest("coach-user", "req-1"), "already_have_coach", 400);
  });

  it("maps a unique-violation race on create to 409 when no assignment is visible", async () => {
    mockPrisma.coach_requests.findFirst.mockResolvedValue(request);
    mockPrisma.coach_clients.findFirst.mockResolvedValue(null);
    mockPrisma.coach_clients.create.mockRejectedValue(p2002());

    const service = getService();
    await expectServiceError(service.acceptRequest("coach-user", "req-1"), "request_already_exists", 409);
  });

  it("throws 404 for an unknown request", async () => {
    mockPrisma.coach_requests.findFirst.mockResolvedValue(null);

    const service = getService();
    await expectServiceError(service.acceptRequest("coach-user", "req-x"), "request_not_found", 404);
  });

  it("throws 400 for a non-pending request", async () => {
    mockPrisma.coach_requests.findFirst.mockResolvedValue({ ...request, status: "accepted" });

    const service = getService();
    await expectServiceError(service.acceptRequest("coach-user", "req-1"), "request_not_pending", 400);
  });
});

describe("CoachAssignmentService.leaveCoach workout cascade", () => {
  it("deletes per-exercise logs before day exercises (FK order)", async () => {
    const order: string[] = [];
    const tx: any = {
      coach_clients: {
        findFirst: jest.fn().mockResolvedValue({ id: "cc-1" }),
        delete: jest.fn().mockResolvedValue({}),
      },
      nutrition_plans: { findMany: jest.fn().mockResolvedValue([]) },
      workout_plans: {
        findMany: jest.fn().mockResolvedValue([{ id: "plan-1" }]),
        deleteMany: jest.fn().mockResolvedValue({}),
      },
      workout_days: {
        findMany: jest.fn().mockResolvedValue([{ id: "day-1" }]),
        deleteMany: jest.fn().mockResolvedValue({}),
      },
      workout_exercise_logs: {
        deleteMany: jest.fn().mockImplementation(async () => {
          order.push("exercise_logs");
          return {};
        }),
      },
      workout_day_exercises: {
        deleteMany: jest.fn().mockImplementation(async () => {
          order.push("day_exercises");
          return {};
        }),
      },
      workout_logs: { deleteMany: jest.fn().mockResolvedValue({}) },
    };
    mockPrisma.client_profiles.findFirst.mockResolvedValue({ id: "client-1" });
    mockPrisma.$transaction.mockImplementation((cb: (tx: any) => unknown) => cb(tx));

    const service = getService();
    const result = await service.leaveCoach("user-1");

    expect(tx.workout_exercise_logs.deleteMany).toHaveBeenCalledWith({
      where: { workout_day_id: { in: ["day-1"] } },
    });
    expect(order).toEqual(["exercise_logs", "day_exercises"]);
    expect(result.message).toBe("Successfully left coach");
  });
});

describe("CoachAssignmentService.getClientProfileForCoach", () => {
  beforeEach(() => {
    mockPrisma.coach_profiles.findFirst.mockResolvedValue({ id: "coach-1", user_id: "coach-user" });
    mockPrisma.coach_clients.findFirst.mockResolvedValue({ id: "cc-1", created_at: new Date() });
    mockPrisma.client_answers.findMany.mockResolvedValue([]);
    mockPrisma.client_questions.count.mockResolvedValue(12);
    mockPrisma.nutrition_plans.findFirst.mockResolvedValue({
      id: "nutri-1",
      title: "Nutrition",
      description: "desc",
      is_active: true,
      created_at: new Date(),
    });
    mockPrisma.workout_plans.findFirst.mockResolvedValue({
      id: "workout-1",
      title: "Workout",
      description: "desc",
      is_active: true,
      created_at: new Date(),
      start_date: new Date(),
      cycle_days: 7,
    });
    mockPrisma.client_profiles.findUnique.mockResolvedValue({
      id: "client-1",
      user: { id: "user-1", username: "client", email: "c@test.com" },
      profile_image: null,
      gender: "male",
      birth_date: null,
      height: 180,
      weight: 80,
      goal: "gain",
    });
  });

  it("returns both plans and no streak fields", async () => {
    const service = getService();
    const result = await service.getClientProfileForCoach("coach-user", "client-1");

    expect(result.nutrition_plan).toMatchObject({ id: "nutri-1" });
    expect(result.workout_plan).toMatchObject({ id: "workout-1", cycle_days: 7 });
    expect(result).not.toHaveProperty("nutrition_streak");
    expect(result).not.toHaveProperty("workout_streak");
    expect(result.total_answers).toBe(0);
    expect(result.total_questions).toBe(12);
    expect(mockPrisma.workout_plans.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { coach_client_id: "cc-1", is_active: true, deleted_at: null },
      })
    );
  });

  it("returns null workout_plan when none active", async () => {
    mockPrisma.workout_plans.findFirst.mockResolvedValue(null);

    const service = getService();
    const result = await service.getClientProfileForCoach("coach-user", "client-1");

    expect(result.workout_plan).toBeNull();
    expect(result.nutrition_plan).toMatchObject({ id: "nutri-1" });
  });

  it("throws 404 when coach is not assigned to this clientProfileId and leaks nothing", async () => {
    mockPrisma.coach_clients.findFirst.mockResolvedValue(null);

    const service = getService();
    await expectServiceError(service.getClientProfileForCoach("coach-user", "client-1"), "client_not_assigned", 404);

    expect(mockPrisma.coach_clients.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { coach_id: "coach-1", client_id: "client-1" } })
    );
    expect(mockPrisma.client_profiles.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.nutrition_plans.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.workout_plans.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.client_questions.count).not.toHaveBeenCalled();
  });

  it("counts distinct groups when client answered both language versions", async () => {
    mockPrisma.client_answers.findMany.mockResolvedValue([
      { id: "a1", client_id: "client-1", question_id: "q-en", answer: "0", created_at: new Date() },
      { id: "a2", client_id: "client-1", question_id: "q-ar", answer: "0", created_at: new Date() },
      { id: "a3", client_id: "client-1", question_id: "q-other", answer: "1", created_at: new Date() },
    ]);
    mockPrisma.client_questions.findMany
      .mockResolvedValueOnce([
        { id: "q-en", group_key: "g1", choices: ["a", "b"], question_type: "choice" },
        { id: "q-ar", group_key: "g1", choices: ["a", "b"], question_type: "choice" },
        { id: "q-other", group_key: "g2", choices: ["a", "b"], question_type: "choice" },
      ])
      .mockResolvedValueOnce([
        { group_key: "g1", question: "Q1", choices: ["a", "b"], question_type: "choice" },
        { group_key: "g2", question: "Q2", choices: ["a", "b"], question_type: "choice" },
      ]);

    const service = getService();
    const result = await service.getClientProfileForCoach("coach-user", "client-1", "en");

    expect(result.questions_answers).toHaveLength(3);
    expect(result.total_answers).toBe(2);
    expect(result.total_questions).toBe(12);
  });

  it("does not crash when an answer references a deleted question", async () => {
    mockPrisma.client_answers.findMany.mockResolvedValue([
      { id: "a1", client_id: "client-1", question_id: "q-gone", answer: "0", created_at: new Date() },
    ]);
    mockPrisma.client_questions.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const service = getService();
    const result = await service.getClientProfileForCoach("coach-user", "client-1", "en");

    expect(result.questions_answers).toHaveLength(1);
    expect(result.questions_answers[0].question).toBeNull();
    expect(result.total_answers).toBe(0);
  });

  it("formats underscore goals with spaces", async () => {
    mockPrisma.client_profiles.findUnique.mockResolvedValue({
      id: "client-1",
      user: { id: "user-1", username: "client", email: "c@test.com" },
      profile_image: null,
      gender: "male",
      birth_date: null,
      height: 180,
      weight: 80,
      goal: "muscle_building",
    });

    const service = getService();
    const result = await service.getClientProfileForCoach("coach-user", "client-1");

    expect(result.client.goal).toBe("muscle building");
  });
});
