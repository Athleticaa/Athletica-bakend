import { Prisma, PrismaClient } from "@prisma/client";
import crypto from "crypto";
import { injectable, inject } from "tsyringe";
import { PrismaClientToken, JwtServiceToken } from "../../di/tokens";
import { JwtService } from "../../lib/jwt";
import { ServiceError } from "../../lib/service-error";
import { config } from "../../config";
import { todayDateOnly, addDays, formatDateOnly } from "../nutrition/nutrition.utils";

const WEEK_DAYS = 7;

export type StreakResult = {
  current: number;
  last_date: string | null;
};

@injectable()
export class CoachAssignmentService {
  constructor(
    @inject(PrismaClientToken) private prisma: PrismaClient,
    @inject(JwtServiceToken) private jwtService: JwtService,
  ) {}

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

  private generateInviteCode(): string {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let result = "";
    const bytes = crypto.randomBytes(6);
    for (let i = 0; i < 6; i++) {
      result += chars[bytes[i] % chars.length];
    }
    return result;
  }

  async generateInvite(userId: string) {
    const profile = await this.getCoachProfile(userId);

    const now = new Date();
    if (
      profile.active_invite_code &&
      profile.active_invite_code_expires_at &&
      profile.active_invite_code_expires_at > now
    ) {
      return {
        code: profile.active_invite_code,
        token: profile.active_invite_code, // fallback alias
        expires_at: profile.active_invite_code_expires_at,
        reused: true,
      };
    }

    let newCode = "";
    let isUnique = false;
    const maxAttempts = 100;
    let attempts = 0;
    while (!isUnique) {
      if (++attempts > maxAttempts) {
        throw new ServiceError("invite_code_generation_failed", 500);
      }
      newCode = this.generateInviteCode();
      const existing = await this.prisma.coach_profiles.findFirst({
        where: { active_invite_code: newCode, active_invite_code_expires_at: { gt: now } },
      });
      if (!existing) isUnique = true;
    }

    const expiresAt = new Date(now.getTime() + config.invite.ttlMs);
    await this.prisma.coach_profiles.update({
      where: { id: profile.id },
      data: { active_invite_code: newCode, active_invite_code_expires_at: expiresAt },
    });

    return { code: newCode, token: newCode, expires_at: expiresAt, reused: false };
  }

  async revokeInvite(userId: string) {
    const profile = await this.getCoachProfile(userId);

    if (!profile.active_invite_code) {
      throw new ServiceError("no_active_invite", 404);
    }

    await this.prisma.coach_profiles.update({
      where: { id: profile.id },
      data: { active_invite_code: null, active_invite_code_expires_at: null },
    });

    return { message: "Invitation link revoked successfully" };
  }

  async submitRequest(userId: string, tokenOrCode: string) {
    const normalizedCode = tokenOrCode.trim().toUpperCase();

    const now = new Date();
    const coachProfile = await this.prisma.coach_profiles.findFirst({
      where: {
        active_invite_code: normalizedCode,
        active_invite_code_expires_at: { gt: now },
      },
      include: {
        user: { select: { username: true, email: true } },
      },
    } as any);

    if (!coachProfile) {
      throw new ServiceError("invalid_or_expired_code", 400);
    }

    if (coachProfile.user_id === userId) {
      throw new ServiceError("cannot_assign_self", 400);
    }

    // Build coach info for response (name/email) — include is requested above,
    // with fallback to a direct users lookup for resilience (e.g. legacy mocks).
    let coach: { id: string; username: string; name: string; email: string } | undefined;
    const embeddedUser = (coachProfile as any).user;
    if (embeddedUser?.username && embeddedUser?.email) {
      coach = {
        id: coachProfile.id,
        username: embeddedUser.username,
        name: embeddedUser.username,
        email: embeddedUser.email,
      };
    } else {
      try {
        const fallbackUser = await (this.prisma as any).users?.findUnique?.({
          where: { id: coachProfile.user_id },
          select: { username: true, email: true },
        });
        if (fallbackUser?.username && fallbackUser?.email) {
          coach = {
            id: coachProfile.id,
            username: fallbackUser.username,
            name: fallbackUser.username,
            email: fallbackUser.email,
          };
        }
      } catch {
        // ignore — coach stays undefined and will be omitted
      }
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
        if (rejectedAt && Date.now() - rejectedAt.getTime() < config.invite.rejectionCooldownMs) {
          throw new ServiceError("wait_before_resubmit", 400);
        }
      }

      if (existingRequest.status === "accepted" || existingRequest.status === "rejected") {
        const record = await this.prisma.coach_requests.update({
          where: { id: existingRequest.id },
          data: { status: "pending", rejected_at: null },
        });
        return { record, created: false, coach };
      }
    }

    try {
      const record = await this.prisma.coach_requests.create({
        data: { coach_id: coachProfile.id, client_id: clientProfileId, status: "pending" },
      });
      return { record, created: true, coach };
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
            user: { select: { username: true, email: true } },
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
            user: { select: { username: true, email: true } },
          },
        },
      },
    });
    return { clients };
  }

  private resolveLanguage(raw?: string): string {
    const v = (raw || "").toLowerCase();
    return v.includes("ar") ? "ar" : "en";
  }

  private async getAnswersForClient(clientId: string, language: string) {
    const answers = await this.prisma.client_answers.findMany({
      where: { client_id: clientId },
      orderBy: { created_at: "asc" },
    });
    if (answers.length === 0) return [];
    const questionIds = answers.map((a) => a.question_id);
    const answeredQuestions = await this.prisma.client_questions.findMany({
      where: { id: { in: questionIds } },
      select: { id: true, group_key: true, choices: true, question_type: true },
    });
    const groupKeys = answeredQuestions.map((q) => q.group_key);
    const langQuestions = await this.prisma.client_questions.findMany({
      where: { group_key: { in: groupKeys }, language },
      select: { group_key: true, question: true, choices: true, question_type: true },
    });
    const langByGroup = new Map(langQuestions.map((q) => [q.group_key, q]));
    const groupByQuestion = new Map(answeredQuestions.map((q) => [q.id, q.group_key]));
    const typeByQuestion = new Map(answeredQuestions.map((q) => [q.id, q.question_type]));
    return answers.map((a) => {
      const groupKey = groupByQuestion.get(a.question_id)!;
      const langQ = langByGroup.get(groupKey);
      const questionType = typeByQuestion.get(a.question_id);
      const isText = questionType === "text";
      let answerText: string | null = null;
      if (isText) {
        answerText = a.answer;
      } else {
        const idx = parseInt(a.answer, 10);
        answerText = !isNaN(idx) ? (langQ?.choices[idx] ?? null) : null;
      }
      return {
        id: a.id,
        client_id: a.client_id,
        question_id: a.question_id,
        answer: a.answer,
        answer_text: answerText,
        created_at: a.created_at,
        question: langQ?.question ?? null,
        question_type: questionType ?? "choice",
      };
    });
  }

  private async getNutritionStreak(clientId: string): Promise<StreakResult> {
    const today = todayDateOnly();
    const start = addDays(today, -(WEEK_DAYS - 1));
    const [totalByDate, completedByDate] = await Promise.all([
      this.prisma.nutrition_meal_logs.groupBy({
        by: ["date"],
        where: { client_id: clientId, date: { gte: start, lte: today } },
        _count: { _all: true },
      }),
      this.prisma.nutrition_meal_logs.groupBy({
        by: ["date"],
        where: { client_id: clientId, completed: true, date: { gte: start, lte: today } },
        _count: { _all: true },
      }),
    ]);
    const totalMap = new Map<string, number>();
    for (const e of totalByDate) totalMap.set(formatDateOnly(e.date), e._count._all);
    const completedMap = new Map<string, number>();
    for (const e of completedByDate) completedMap.set(formatDateOnly(e.date), e._count._all);

    let current = 0;
    let last_date: string | null = null;

    // Find last_date: most recent completed day within window
    for (let i = 0; i < WEEK_DAYS; i++) {
      const d = addDays(today, -i);
      const key = formatDateOnly(d);
      const total = totalMap.get(key);
      const completed = completedMap.get(key) ?? 0;
      if (total !== undefined && total > 0 && completed === total) {
        last_date = key;
        break;
      }
    }

    // Current streak: consecutive from today backwards
    for (let i = 0; i < WEEK_DAYS; i++) {
      const d = addDays(today, -i);
      const key = formatDateOnly(d);
      const total = totalMap.get(key);
      if (total === undefined || total === 0) break;
      const completed = completedMap.get(key) ?? 0;
      if (completed === total) current++;
      else break;
    }

    return { current, last_date };
  }

  private async getWorkoutStreak(clientId: string): Promise<StreakResult> {
    const today = todayDateOnly();
    const start = addDays(today, -(WEEK_DAYS - 1));
    const [totalByDate, completedByDate] = await Promise.all([
      this.prisma.workout_logs.groupBy({
        by: ["workout_date"],
        where: { client_id: clientId, workout_date: { gte: start, lte: today } },
        _count: { _all: true },
      }),
      this.prisma.workout_logs.groupBy({
        by: ["workout_date"],
        where: { client_id: clientId, completed: true, workout_date: { gte: start, lte: today } },
        _count: { _all: true },
      }),
    ]);
    const totalMap = new Map<string, number>();
    for (const e of totalByDate as any[]) totalMap.set(formatDateOnly((e as any).workout_date), (e as any)._count._all);
    const completedMap = new Map<string, number>();
    for (const e of completedByDate as any[]) completedMap.set(formatDateOnly((e as any).workout_date), (e as any)._count._all);

    let current = 0;
    let last_date: string | null = null;

    for (let i = 0; i < WEEK_DAYS; i++) {
      const d = addDays(today, -i);
      const key = formatDateOnly(d);
      const total = totalMap.get(key);
      const completed = completedMap.get(key) ?? 0;
      if (total !== undefined && total > 0 && completed === total) {
        last_date = key;
        break;
      }
    }

    for (let i = 0; i < WEEK_DAYS; i++) {
      const d = addDays(today, -i);
      const key = formatDateOnly(d);
      const total = totalMap.get(key);
      if (total === undefined || total === 0) break;
      const completed = completedMap.get(key) ?? 0;
      if (completed === total) current++;
      else break;
    }

    return { current, last_date };
  }

  private async getActiveNutritionPlanSummary(coachClientId: string) {
    const plan = await this.prisma.nutrition_plans.findFirst({
      where: { coach_client_id: coachClientId, is_active: true },
      orderBy: { created_at: "desc" },
      select: { id: true, title: true, description: true, is_active: true, created_at: true },
    });
    return plan ?? null;
  }

  async getClientProfileForCoach(coachUserId: string, clientProfileId: string, acceptLanguage?: string) {
    const coachProfileId = await this.getCoachProfileId(coachUserId);

    const coachClient = await this.prisma.coach_clients.findFirst({
      where: { coach_id: coachProfileId, client_id: clientProfileId },
      select: { id: true, created_at: true },
    });
    if (!coachClient) throw new ServiceError("client_not_assigned", 404);

    const language = this.resolveLanguage(acceptLanguage);

    const [clientProfile, questionsAnswers, nutritionPlan, nutritionStreak, workoutStreak] = await Promise.all([
      this.prisma.client_profiles.findUnique({
        where: { id: clientProfileId },
        include: { user: { select: { id: true, username: true, email: true } } },
      }),
      this.getAnswersForClient(clientProfileId, language),
      this.getActiveNutritionPlanSummary(coachClient.id),
      this.getNutritionStreak(clientProfileId),
      this.getWorkoutStreak(clientProfileId),
    ]);

    if (!clientProfile) throw new ServiceError("client_profile_not_found", 404);

    return {
      client: {
        id: clientProfile.id,
        user: clientProfile.user
          ? { id: clientProfile.user.id, username: clientProfile.user.username, email: clientProfile.user.email, name: clientProfile.user.username }
          : null,
        profile_image: clientProfile.profile_image ?? null,
        gender: clientProfile.gender,
        birth_date: clientProfile.birth_date ?? null,
        height: clientProfile.height ?? null,
        weight: clientProfile.weight ?? null,
        goal: clientProfile.goal,
        assigned_at: coachClient.created_at,
      },
      nutrition_plan: nutritionPlan,
      workout_plan: null as null,
      nutrition_streak: nutritionStreak,
      workout_streak: workoutStreak,
      questions_answers: questionsAnswers,
    };
  }

  async getMyCoach(userId: string) {
    const clientProfileId = await this.getClientProfileId(userId);
    const assignment = await this.prisma.coach_clients.findFirst({
      where: { client_id: clientProfileId },
      include: {
        coach: {
          include: {
            user: { select: { username: true, email: true } },
          },
        },
      },
    });
    if (!assignment) throw new ServiceError("no_coach_assigned", 404);
    return { coach: assignment.coach, assigned_at: assignment.created_at };
  }

  private async deleteCoachClientCascade(tx: Prisma.TransactionClient, coachClientId: string) {
    // Nutrition chain: meal_logs → meal_foods → meals → plans
    const nutritionPlanIds = (
      await tx.nutrition_plans.findMany({
        where: { coach_client_id: coachClientId },
        select: { id: true },
      })
    ).map((p: { id: string }) => p.id);

    if (nutritionPlanIds.length > 0) {
      await tx.nutrition_meal_logs.deleteMany({ where: { nutrition_plan_id: { in: nutritionPlanIds } } });
      await tx.nutrition_meal_foods.deleteMany({
        where: { nutrition_meal: { nutrition_plan_id: { in: nutritionPlanIds } } },
      });
      await tx.nutrition_meals.deleteMany({ where: { nutrition_plan_id: { in: nutritionPlanIds } } });
      await tx.nutrition_plans.deleteMany({ where: { id: { in: nutritionPlanIds } } });
    }

    // Workout chain: day_exercises + logs → days → plans
    const workoutPlanIds = (
      await tx.workout_plans.findMany({
        where: { coach_client_id: coachClientId },
        select: { id: true },
      })
    ).map((p: { id: string }) => p.id);

    if (workoutPlanIds.length > 0) {
      const workoutDayIds = (
        await tx.workout_days.findMany({
          where: { workout_plan_id: { in: workoutPlanIds } },
          select: { id: true },
        })
      ).map((d: { id: string }) => d.id);

      if (workoutDayIds.length > 0) {
        await tx.workout_day_exercises.deleteMany({ where: { workout_day_id: { in: workoutDayIds } } });
        await tx.workout_logs.deleteMany({ where: { workout_day_id: { in: workoutDayIds } } });
      }
      await tx.workout_days.deleteMany({ where: { workout_plan_id: { in: workoutPlanIds } } });
      await tx.workout_plans.deleteMany({ where: { id: { in: workoutPlanIds } } });
    }

    await tx.coach_clients.delete({ where: { id: coachClientId } });
  }

  async leaveCoach(userId: string) {
    const clientProfileId = await this.getClientProfileId(userId);
    await this.prisma.$transaction(async (tx) => {
      const cc = await tx.coach_clients.findFirst({
        where: { client_id: clientProfileId },
        select: { id: true },
      });
      if (!cc) throw new ServiceError("no_coach_assigned", 404);
      await this.deleteCoachClientCascade(tx, cc.id);
    });
    return { message: "Successfully left coach" };
  }

  async removeClient(userId: string, clientId: string) {
    const coachProfileId = await this.getCoachProfileId(userId);
    await this.prisma.$transaction(async (tx) => {
      const cc = await tx.coach_clients.findFirst({
        where: { coach_id: coachProfileId, client_id: clientId },
        select: { id: true },
      });
      if (!cc) throw new ServiceError("client_not_assigned", 404);
      await this.deleteCoachClientCascade(tx, cc.id);
    });
    return { message: "Client removed from roster" };
  }
}
