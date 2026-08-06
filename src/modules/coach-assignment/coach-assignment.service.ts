import { Prisma, PrismaClient } from "@prisma/client";
import { injectable, container } from "tsyringe";
import { PrismaClientToken } from "../../di/tokens";
import { JwtService } from "../../lib/jwt";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const REJECTION_COOLDOWN_MS = 5 * 60 * 1000;

export class ServiceError extends Error {
  statusCode: number;
  messageKey: string;
  constructor(messageKey: string, statusCode: number) {
    super(messageKey);
    this.messageKey = messageKey;
    this.statusCode = statusCode;
  }
}

@injectable()
export class CoachAssignmentService {
  private prisma: PrismaClient;
  private jwtService: JwtService;

  constructor() {
    this.prisma = container.resolve(PrismaClientToken);
    this.jwtService = container.resolve(JwtService);
  }

  async getCoachProfileId(userId: string): Promise<string> {
    const profile = await this.prisma.coach_profiles.findFirst({ where: { user_id: userId } });
    if (!profile) throw new ServiceError("coach_profile_not_found", 404);
    return profile.id;
  }

  private async getCoachProfile(userId: string) {
    const profile = await this.prisma.coach_profiles.findFirst({ where: { user_id: userId } });
    if (!profile) throw new ServiceError("coach_profile_not_found", 404);
    return profile;
  }

  private isUniqueViolation(err: unknown): boolean {
    return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
  }

  async getClientProfileId(userId: string): Promise<string> {
    const profile = await this.prisma.client_profiles.findFirst({ where: { user_id: userId } });
    if (!profile) throw new ServiceError("client_profile_not_found", 404);
    return profile.id;
  }

  async generateInvite(userId: string) {
    const profile = await this.getCoachProfile(userId);

    const now = new Date();
    if (
      profile.active_invite_token &&
      profile.active_invite_token_expires_at &&
      profile.active_invite_token_expires_at > now
    ) {
      return {
        token: profile.active_invite_token,
        expires_at: profile.active_invite_token_expires_at,
        reused: true,
      };
    }

    const token = this.jwtService.signInviteToken(profile.id);
    const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
    await this.prisma.coach_profiles.update({
      where: { id: profile.id },
      data: { active_invite_token: token, active_invite_token_expires_at: expiresAt },
    });

    return { token, expires_at: expiresAt, reused: false };
  }

  async revokeInvite(userId: string) {
    const profile = await this.getCoachProfile(userId);

    if (!profile.active_invite_token) {
      throw new ServiceError("no_active_invite", 404);
    }

    await this.prisma.coach_profiles.update({
      where: { id: profile.id },
      data: { active_invite_token: null, active_invite_token_expires_at: null },
    });

    return { message: "Invitation link revoked successfully" };
  }

  async submitRequest(userId: string, token: string) {
    let payload;
    try {
      payload = this.jwtService.verifyInviteToken(token);
    } catch {
      throw new ServiceError("invalid_or_expired_token", 400);
    }

    const coachProfile = await this.prisma.coach_profiles.findUnique({
      where: { id: payload.coach_profile_id },
    });
    if (!coachProfile) throw new ServiceError("invalid_or_expired_token", 400);

    if (
      !coachProfile.active_invite_token ||
      coachProfile.active_invite_token !== token ||
      !coachProfile.active_invite_token_expires_at ||
      coachProfile.active_invite_token_expires_at < new Date()
    ) {
      throw new ServiceError("invalid_or_expired_token", 400);
    }

    if (coachProfile.user_id === userId) {
      throw new ServiceError("cannot_assign_self", 400);
    }

    const clientProfileId = await this.getClientProfileId(userId);

    const existingAssignment = await this.prisma.coach_clients.findFirst({
      where: { client_id: clientProfileId },
    });
    if (existingAssignment) {
      throw new ServiceError("already_have_coach", 400);
    }

    const existingRequest = await this.prisma.coach_requests.findUnique({
      where: { coach_id_client_id: { coach_id: coachProfile.id, client_id: clientProfileId } },
    });

    if (existingRequest) {
      if (existingRequest.status === "pending") {
        throw new ServiceError("request_already_exists", 409);
      }

      if (existingRequest.status === "rejected") {
        const rejectedAt = existingRequest.rejected_at;
        if (rejectedAt && Date.now() - rejectedAt.getTime() < REJECTION_COOLDOWN_MS) {
          throw new ServiceError("wait_before_resubmit", 400);
        }
      }

      if (existingRequest.status === "accepted" || existingRequest.status === "rejected") {
        const record = await this.prisma.coach_requests.update({
          where: { id: existingRequest.id },
          data: { status: "pending", rejected_at: null },
        });
        return { record, created: false };
      }
    }

    try {
      const record = await this.prisma.coach_requests.create({
        data: { coach_id: coachProfile.id, client_id: clientProfileId, status: "pending" },
      });
      return { record, created: true };
    } catch (err) {
      if (this.isUniqueViolation(err)) {
        throw new ServiceError("request_already_exists", 409);
      }
      throw err;
    }
  }

  async listRequests(userId: string) {
    const coachProfileId = await this.getCoachProfileId(userId);
    const requests = await this.prisma.coach_requests.findMany({
      where: { coach_id: coachProfileId },
      orderBy: { created_at: "desc" },
      include: {
        client: {
          include: {
            user: { select: { first_name: true, last_name: true, email: true } },
          },
        },
      },
    });
    return { requests };
  }

  async acceptRequest(userId: string, requestId: string) {
    const coachProfileId = await this.getCoachProfileId(userId);
    const request = await this.prisma.coach_requests.findFirst({
      where: { id: requestId, coach_id: coachProfileId },
    });
    if (!request) throw new ServiceError("request_not_found", 404);
    if (request.status !== "pending") throw new ServiceError("request_not_pending", 400);

    try {
      const [updatedRequest, assignment] = await this.prisma.$transaction(async (tx) => {
        const existingAssignment = await tx.coach_clients.findFirst({
          where: { client_id: request.client_id },
        });
        if (existingAssignment && existingAssignment.coach_id !== request.coach_id) {
          throw new ServiceError("already_have_coach", 400);
        }
        const updated = await tx.coach_requests.update({
          where: { id: request.id },
          data: { status: "accepted" },
        });
        const created = await tx.coach_clients.create({
          data: { coach_id: request.coach_id, client_id: request.client_id },
        });
        await tx.coach_requests.updateMany({
          where: { client_id: request.client_id, coach_id: { not: request.coach_id }, status: "pending" },
          data: { status: "rejected", rejected_at: new Date() },
        });
        return [updated, created];
      });
      return { request: updatedRequest, assignment };
    } catch (err) {
      if (this.isUniqueViolation(err)) {
        const winner = await this.prisma.coach_clients.findFirst({
          where: { client_id: request.client_id },
        });
        if (winner && winner.coach_id === request.coach_id) {
          throw new ServiceError("request_not_pending", 400);
        }
        if (winner) {
          throw new ServiceError("already_have_coach", 400);
        }
        throw new ServiceError("request_already_exists", 409);
      }
      throw err;
    }
  }

  async rejectRequest(userId: string, requestId: string) {
    const coachProfileId = await this.getCoachProfileId(userId);
    const request = await this.prisma.coach_requests.findFirst({
      where: { id: requestId, coach_id: coachProfileId },
    });
    if (!request) throw new ServiceError("request_not_found", 404);
    if (request.status !== "pending") throw new ServiceError("request_not_pending", 400);

    return this.prisma.coach_requests.update({
      where: { id: request.id },
      data: { status: "rejected", rejected_at: new Date() },
    });
  }

  async listClients(userId: string) {
    const coachProfileId = await this.getCoachProfileId(userId);
    const clients = await this.prisma.coach_clients.findMany({
      where: { coach_id: coachProfileId },
      orderBy: { created_at: "desc" },
      include: {
        client: {
          include: {
            user: { select: { first_name: true, last_name: true, email: true } },
          },
        },
      },
    });
    return { clients };
  }

  async getMyCoach(userId: string) {
    const clientProfileId = await this.getClientProfileId(userId);
    const assignment = await this.prisma.coach_clients.findFirst({
      where: { client_id: clientProfileId },
      include: {
        coach: {
          include: {
            user: { select: { first_name: true, last_name: true, email: true } },
          },
        },
      },
    });
    if (!assignment) throw new ServiceError("no_coach_assigned", 404);
    return { coach: assignment.coach, assigned_at: assignment.created_at };
  }

  async leaveCoach(userId: string) {
    const clientProfileId = await this.getClientProfileId(userId);
    const result = await this.prisma.coach_clients.deleteMany({
      where: { client_id: clientProfileId },
    });
    if (result.count === 0) throw new ServiceError("no_coach_assigned", 404);
    return { message: "Successfully left coach" };
  }

  async removeClient(userId: string, clientId: string) {
    const coachProfileId = await this.getCoachProfileId(userId);
    const result = await this.prisma.coach_clients.deleteMany({
      where: { coach_id: coachProfileId, client_id: clientId },
    });
    if (result.count === 0) throw new ServiceError("client_not_assigned", 404);
    return { message: "Client removed from roster" };
  }
}
