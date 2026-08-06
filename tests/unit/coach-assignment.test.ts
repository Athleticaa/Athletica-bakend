import "reflect-metadata";
import { Prisma } from "@prisma/client";
import { container } from "tsyringe";
import { PrismaClientToken } from "../../src/di/tokens";
import { JwtService } from "../../src/lib/jwt";
import {
  CoachAssignmentService,
  ServiceError,
} from "../../src/modules/coach-assignment/coach-assignment.service";

const mockPrisma = {
  coach_profiles: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  client_profiles: {
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
  container.registerInstance(PrismaClientToken, mockPrisma as any);
  container.registerInstance(JwtService, mockJwt as any);
  return new CoachAssignmentService();
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
    mockPrisma.coach_profiles.findFirst.mockResolvedValue({
      id: "coach-1",
      active_invite_token: null,
      active_invite_token_expires_at: null,
    });
    mockJwt.signInviteToken.mockReturnValue("token-abc");

    const service = getService();
    const result = await service.generateInvite("user-1");

    expect(result.token).toBe("token-abc");
    expect(result.reused).toBe(false);
    expect(mockPrisma.coach_profiles.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.coach_profiles.update).toHaveBeenCalledWith({
      where: { id: "coach-1" },
      data: {
        active_invite_token: "token-abc",
        active_invite_token_expires_at: expect.any(Date),
      },
    });
  });

  it("returns the SAME token when an unexpired one exists (idempotent)", async () => {
    mockPrisma.coach_profiles.findFirst.mockResolvedValue({
      id: "coach-1",
      active_invite_token: "existing-token",
      active_invite_token_expires_at: new Date(Date.now() + 60 * 60 * 1000),
    });

    const service = getService();
    const result = await service.generateInvite("user-1");

    expect(result.token).toBe("existing-token");
    expect(result.reused).toBe(true);
    expect(mockPrisma.coach_profiles.update).not.toHaveBeenCalled();
    expect(mockJwt.signInviteToken).not.toHaveBeenCalled();
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
    active_invite_token: "valid-token",
    active_invite_token_expires_at: new Date(Date.now() + 60 * 60 * 1000),
  };

  beforeEach(() => {
    mockJwt.verifyInviteToken.mockReturnValue({
      coach_profile_id: "coach-1",
      type: "invite",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60 * 60,
    });
    mockPrisma.coach_profiles.findUnique.mockResolvedValue(coachProfile);
    mockPrisma.client_profiles.findFirst.mockResolvedValue({ id: "client-1" });
    mockPrisma.coach_clients.findFirst.mockResolvedValue(null);
    mockPrisma.coach_requests.findUnique.mockResolvedValue(null);
  });

  it("throws 400 for invalid/expired token", async () => {
    mockJwt.verifyInviteToken.mockImplementation(() => {
      throw new Error("jwt expired");
    });

    const service = getService();
    await expectServiceError(
      service.submitRequest("client-user", "bad-token"),
      INVALID_OR_EXPIRED,
      400
    );
  });

  it("throws 400 when the stored token does not match", async () => {
    mockPrisma.coach_profiles.findUnique.mockResolvedValue({
      ...coachProfile,
      active_invite_token: "different-token",
    });

    const service = getService();
    await expectServiceError(
      service.submitRequest("client-user", "valid-token"),
      INVALID_OR_EXPIRED,
      400
    );
  });

  it("throws 400 on self-assignment", async () => {
    const service = getService();
    await expectServiceError(service.submitRequest("coach-user", "valid-token"), "cannot_assign_self", 400);
  });

  it("throws 400 when the client already has a coach", async () => {
    mockPrisma.coach_clients.findFirst.mockResolvedValue({ id: "assignment-1" });

    const service = getService();
    await expectServiceError(service.submitRequest("client-user", "valid-token"), "already_have_coach", 400);
  });

  it("throws 409 on duplicate pending request", async () => {
    mockPrisma.coach_requests.findUnique.mockResolvedValue({ id: "req-1", status: "pending" });

    const service = getService();
    await expectServiceError(service.submitRequest("client-user", "valid-token"), "request_already_exists", 409);
  });

  it("throws 400 when resubmitting within 5 minutes of rejection", async () => {
    mockPrisma.coach_requests.findUnique.mockResolvedValue({
      id: "req-1",
      status: "rejected",
      rejected_at: new Date(Date.now() - 60 * 1000),
    });

    const service = getService();
    await expectServiceError(service.submitRequest("client-user", "valid-token"), "wait_before_resubmit", 400);
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
    const result = await service.submitRequest("client-user", "valid-token");

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
    const result = await service.submitRequest("client-user", "valid-token");

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
    const result = await service.submitRequest("client-user", "valid-token");

    expect(result.created).toBe(true);
    expect(mockPrisma.coach_requests.create).toHaveBeenCalledWith({
      data: { coach_id: "coach-1", client_id: "client-1", status: "pending" },
    });
  });

  it("throws 404 when the client profile does not exist", async () => {
    mockPrisma.client_profiles.findFirst.mockResolvedValue(null);

    const service = getService();
    await expectServiceError(service.submitRequest("client-user", "valid-token"), "client_profile_not_found", 404);
  });

  it("maps a unique-violation race on create to 409", async () => {
    mockPrisma.coach_requests.create.mockRejectedValue(p2002());

    const service = getService();
    await expectServiceError(service.submitRequest("client-user", "valid-token"), "request_already_exists", 409);
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
