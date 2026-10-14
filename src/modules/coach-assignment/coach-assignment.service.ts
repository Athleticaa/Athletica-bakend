import { Prisma, PrismaClient } from "@prisma/client";
import crypto from "crypto";
import { injectable, inject } from "tsyringe";
import { PrismaClientToken, JwtServiceToken } from "../../di/tokens";
import { JwtService } from "../../lib/jwt";
import { ServiceError } from "../../lib/service-error";
import { formatGoal } from "../../lib/format-goal";
import { config } from "../../config";
import { CacheService, cacheKeys } from "../../lib/cache";
import { PushService } from "../../services/push";
import { NotificationsService } from "../notifications/notifications.service";
import { withActorData } from "../notifications/notification-actor";
import i18next from "../../lib/i18n";
import { withTimeout } from "../../lib/with-timeout";

@injectable()
export class CoachAssignmentService {
  constructor(
    @inject(PrismaClientToken) private prisma: PrismaClient,
    @inject(JwtServiceToken) private jwtService: JwtService,
    @inject(PushService) private push?: PushService,
    @inject(NotificationsService) private inbox?: NotificationsService,
  ) {}

  /**
   * Persist the inbox row best-effort. Never throws — inbox write failure
   * must not break the domain request (same philosophy as pushes).
   * Time-bounded like the lookups so a slow DB can't push added latency
   * past the documented push budget. Returns the notification id for
   * FCM `data.notificationId`, if stored.
   */
  private async persistInbox(
    recipientUserId: string,
    type: "coach_request" | "request_accepted",
    title: string,
    body: string,
    data: Record<string, string>,
  ): Promise<string | undefined> {
    if (!this.inbox) return undefined;
    try {
      const row = await withTimeout(
        this.inbox.create(recipientUserId, { type, title, body, data }),
        config.push.dbLookupTimeoutMs,
        "inbox_create_timeout",
      );
      return row.id;
    } catch (err) {
      const reason = err instanceof Error ? err.message : "unknown";
      console.error(`[coach-assignment] inbox persist failed type=${type} reason=${reason}`);
      return undefined;
    }
  }

  /** Best-effort inbox + push. Never throws. */
  private async notifyCoachOfRequest(coachUserId: string, clientUserId: string, requestId: string) {
    try {
      const [client, clientProfile] = await withTimeout(
        Promise.all([
          this.prisma.users.findUnique({
            where: { id: clientUserId },
            select: { username: true },
          }),
          this.prisma.client_profiles.findFirst({
            where: { user_id: clientUserId },
            select: { profile_image: true },
          }),
        ]),
        config.push.dbLookupTimeoutMs,
        "notify_lookup_timeout",
      );
      const t = (key: string, opts?: Record<string, string>) =>
        i18next.t(key, { lng: "en", ...opts });
      const title = t("push_coach_request_title");
      const body = t("push_coach_request_body", { client: client?.username ?? "A client" });
      const data = withActorData(
        {
          type: "coach_request",
          requestId,
          click_action: "FLUTTER_NOTIFICATION_CLICK",
        },
        {
          userId: clientUserId,
          username: client?.username,
          profileImage: clientProfile?.profile_image ?? undefined,
          role: "client",
        },
      );
      const notificationId = await this.persistInbox(coachUserId, "coach_request", title, body, data);
      if (!this.push) return;
      await this.push.sendToUser(coachUserId, {
        title,
        body,
        data: notificationId ? { ...data, notificationId } : data,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : "unknown";
      console.error(`[coach-assignment] request push failed reason=${reason}`);
    }
  }

  /** Best-effort inbox + push. Never throws. */
  private async notifyClientOfAcceptance(
    clientUserId: string,
    coach: { userId: string; username: string; profileImage?: string },
    assignmentId: string,
  ) {
    try {
      const t = (key: string, opts?: Record<string, string>) =>
        i18next.t(key, { lng: "en", ...opts });
      const title = t("push_request_accepted_title");
      const body = t("push_request_accepted_body", { coach: coach.username });
      const data = withActorData(
        {
          type: "request_accepted",
          assignmentId,
          click_action: "FLUTTER_NOTIFICATION_CLICK",
        },
        {
          userId: coach.userId,
          username: coach.username,
          profileImage: coach.profileImage,
          role: "coach",
        },
      );
      const notificationId = await this.persistInbox(
        clientUserId,
        "request_accepted",
        title,
        body,
        data,
      );
      if (!this.push) return;
      await this.push.sendToUser(clientUserId, {
        title,
        body,
        data: notificationId ? { ...data, notificationId } : data,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : "unknown";
      console.error(`[coach-assignment] acceptance push failed reason=${reason}`);
    }
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

  /**
   * Post-commit sync for roster membership changes (leave/remove). Drops
   * every cached view of the severed relationship: roster + request lists,
   * the client item + mycoach keys, check-in gating keys, and all plan keys
   * (the cascade deletes the plans). Profiles/answers are untouched by
   * roster removal; notifications are historical — both skipped deliberately.
   */
  private async delRosterCaches(
    coachId: string,
    clientProfileId: string,
    coachClientId: string,
    workoutPlanIds: string[],
    nutritionPlanIds: string[],
  ): Promise<void> {
    await CacheService.delByPrefix(cacheKeys.coachClients(coachId));
    await CacheService.delByPrefix(cacheKeys.coachRequests(coachId));
    await CacheService.del(cacheKeys.myCoach(clientProfileId));
    await CacheService.delByPrefix(cacheKeys.coachClientItemPrefix(clientProfileId));
    await CacheService.del(cacheKeys.checkinSubmissions(clientProfileId));
    await CacheService.del(cacheKeys.checkinCoachSubmissions(coachId, coachClientId));
    await CacheService.delByPrefix(cacheKeys.checkinCoachSubmissionDetailPrefix(coachId, coachClientId));
    await CacheService.del(cacheKeys.checkinClientQuestions(clientProfileId));
    await CacheService.del(cacheKeys.workoutPlanMine(clientProfileId));
    await CacheService.del(cacheKeys.nutritionPlanMine(clientProfileId));
    for (const pid of workoutPlanIds) {
      await CacheService.del(cacheKeys.workoutPlanItem(coachId, pid));
      await CacheService.del(cacheKeys.workoutPlanDetail(clientProfileId, pid));
    }
    for (const pid of nutritionPlanIds) {
      await CacheService.delByPrefix(cacheKeys.nutritionPlanItemPrefix(coachId, pid));
      await CacheService.delByPrefix(cacheKeys.nutritionPlanDetailPrefix(clientProfileId, pid));
    }
  }

  /** Plan ids behind an assignment row (fetched pre-delete: cascade removes them). */
  private async assignmentPlanIds(
    coachClientId: string,
  ): Promise<{ workoutPlanIds: string[]; nutritionPlanIds: string[] }> {
    const [wPlans, nPlans] = await Promise.all([
      this.prisma.workout_plans
        .findMany({ where: { coach_client_id: coachClientId }, select: { id: true } })
        .catch(() => [] as Array<{ id: string }>),
      this.prisma.nutrition_plans
        .findMany({ where: { coach_client_id: coachClientId }, select: { id: true } })
        .catch(() => [] as Array<{ id: string }>),
    ]);
    return {
      workoutPlanIds: wPlans.map((p) => p.id),
      nutritionPlanIds: nPlans.map((p) => p.id),
    };
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

    let coach: { id: string; username: string; name: string; email: string; profile_image: string | null } | undefined;
    const embeddedUser = (coachProfile as any).user;
    if (embeddedUser?.username && embeddedUser?.email) {
      coach = {
        id: coachProfile.id,
        username: embeddedUser.username,
        name: embeddedUser.username,
        email: embeddedUser.email,
        profile_image: coachProfile.profile_image ?? null,
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
            profile_image: coachProfile.profile_image ?? null,
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
        await this.notifyCoachOfRequest(coachProfile.user_id, userId, record.id);
        await CacheService.delByPrefix(cacheKeys.coachRequests(coachProfile.id));
        return { record, created: false, coach };
      }
    }

    try {
      const record = await this.prisma.coach_requests.create({
        data: { coach_id: coachProfile.id, client_id: clientProfileId, status: "pending" },
      });
      await this.notifyCoachOfRequest(coachProfile.user_id, userId, record.id);
      await CacheService.delByPrefix(cacheKeys.coachRequests(coachProfile.id));
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
    return CacheService.getOrSet(
      cacheKeys.coachRequests(coachProfileId),
      config.cache.ttlSec.coachRequests,
      () => this.loadRequests(coachProfileId),
    );
  }

  private async loadRequests(coachProfileId: string) {
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
      // Resolve the client user + coach identity for the acceptance
      // inbox row and push. Bounded best-effort: on slow DB the assignment
      // still succeeds.
      try {
        const [clientProfile, coachUser, coachProfile] = await withTimeout(
          Promise.all([
            this.prisma.client_profiles.findFirst({
              where: { id: request.client_id },
              select: { user_id: true },
            }),
            this.prisma.users.findUnique({
              where: { id: userId },
              select: { username: true },
            }),
            this.prisma.coach_profiles.findFirst({
              where: { id: coachProfileId },
              select: { profile_image: true },
            }),
          ]),
          config.push.dbLookupTimeoutMs,
          "notify_lookup_timeout",
        );
        if (clientProfile) {
          await this.notifyClientOfAcceptance(
            clientProfile.user_id,
            {
              userId,
              username: coachUser?.username ?? "Your coach",
              profileImage: coachProfile?.profile_image ?? undefined,
            },
            assignment.id,
          );
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : "unknown";
        console.error(`[coach-assignment] acceptance lookup failed reason=${reason}`);
      }
      // Membership changed: drop the coach's request/roster lists, the
      // client's mycoach + profile snapshot (embeds assignment + plans) +
      // check-in gating keys (assignment now exists).
      // Cross-coach request lists rely on short TTL (accepted tradeoff).
      await CacheService.delByPrefix(cacheKeys.coachRequests(coachProfileId));
      await CacheService.delByPrefix(cacheKeys.coachClients(coachProfileId));
      await CacheService.del(cacheKeys.myCoach(request.client_id));
      await CacheService.del(cacheKeys.checkinClientQuestions(request.client_id));
      const clientUser = await this.prisma.client_profiles
        .findUnique({ where: { id: request.client_id }, select: { user_id: true } })
        .catch(() => null);
      if (clientUser) await CacheService.del(cacheKeys.profile(clientUser.user_id));
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

    const rejected = await this.prisma.coach_requests.update({
      where: { id: request.id },
      data: { status: "rejected", rejected_at: new Date() },
    });
    await CacheService.delByPrefix(cacheKeys.coachRequests(coachProfileId));
    return rejected;
  }

  async listClients(userId: string) {
    const coachProfileId = await this.getCoachProfileId(userId);
    return CacheService.getOrSet(
      cacheKeys.coachClients(coachProfileId),
      config.cache.ttlSec.coachClients,
      () => this.loadClients(coachProfileId),
    );
  }

  private async loadClients(coachProfileId: string) {
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
    if (answers.length === 0) return { items: [], total: 0 };
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
    const distinctGroups = new Set<string>();
    for (const a of answers) {
      const g = groupByQuestion.get(a.question_id);
      if (g) distinctGroups.add(g);
    }
    const items = answers.map((a) => {
      const groupKey = groupByQuestion.get(a.question_id);
      const langQ = groupKey ? langByGroup.get(groupKey) : undefined;
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
    return { items, total: distinctGroups.size };
  }

  private async getActiveNutritionPlanSummary(coachClientId: string) {
    const plan = await this.prisma.nutrition_plans.findFirst({
      where: { coach_client_id: coachClientId, is_active: true },
      orderBy: { created_at: "desc" },
      select: { id: true, title: true, description: true, is_active: true, created_at: true },
    });
    return plan ?? null;
  }

  private async getActiveWorkoutPlanSummary(coachClientId: string) {
    const plan = await this.prisma.workout_plans.findFirst({
      where: { coach_client_id: coachClientId, is_active: true, deleted_at: null },
      orderBy: { created_at: "desc" },
      select: {
        id: true,
        title: true,
        description: true,
        is_active: true,
        created_at: true,
        start_date: true,
        cycle_days: true,
      },
    });
    return plan ?? null;
  }

  async getClientProfileForCoach(coachUserId: string, clientProfileId: string, acceptLanguage?: string) {
    const coachProfileId = await this.getCoachProfileId(coachUserId);
    const language = this.resolveLanguage(acceptLanguage);
    return CacheService.getOrSet(
      cacheKeys.coachClientItem(clientProfileId, language),
      config.cache.ttlSec.coachClientItem,
      () => this.loadClientProfileForCoach(coachProfileId, clientProfileId, language),
    );
  }

  private async loadClientProfileForCoach(
    coachProfileId: string,
    clientProfileId: string,
    language: string,
  ) {
    const coachClient = await this.prisma.coach_clients.findFirst({
      where: { coach_id: coachProfileId, client_id: clientProfileId },
      select: { id: true, created_at: true },
    });
    if (!coachClient) throw new ServiceError("client_not_assigned", 404);

    const [clientProfile, answersResult, nutritionPlan, workoutPlan, totalQuestions] = await Promise.all([
      this.prisma.client_profiles.findUnique({
        where: { id: clientProfileId },
        include: { user: { select: { id: true, username: true, email: true } } },
      }),
      this.getAnswersForClient(clientProfileId, language),
      this.getActiveNutritionPlanSummary(coachClient.id),
      this.getActiveWorkoutPlanSummary(coachClient.id),
      this.prisma.client_questions.count({ where: { language } }),
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
        goal: formatGoal(clientProfile.goal),
        assigned_at: coachClient.created_at,
      },
      nutrition_plan: nutritionPlan,
      workout_plan: workoutPlan,
      questions_answers: answersResult.items,
      total_answers: answersResult.total,
      total_questions: totalQuestions,
    };
  }

  async getMyCoach(userId: string) {
    const clientProfileId = await this.getClientProfileId(userId);
    return CacheService.getOrSet(
      cacheKeys.myCoach(clientProfileId),
      config.cache.ttlSec.myCoach,
      () => this.loadMyCoach(clientProfileId),
    );
  }

  private async loadMyCoach(clientProfileId: string) {
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
    return { coach: assignment.coach, assigned_at: assignment.created_at, assignment_id: assignment.id };
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

    // Workout chain: exercise_logs + day_exercises + day_logs → days → plans
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
        await tx.workout_exercise_logs.deleteMany({ where: { workout_day_id: { in: workoutDayIds } } });
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
    const pre = await this.prisma.coach_clients.findFirst({
      where: { client_id: clientProfileId },
      select: { id: true, coach_id: true },
    });
    if (!pre) throw new ServiceError("no_coach_assigned", 404);
    const { workoutPlanIds, nutritionPlanIds } = await this.assignmentPlanIds(pre.id);
    await this.prisma.$transaction(async (tx) => {
      const cc = await tx.coach_clients.findFirst({
        where: { client_id: clientProfileId },
        select: { id: true },
      });
      if (!cc) throw new ServiceError("no_coach_assigned", 404);
      await this.deleteCoachClientCascade(tx, cc.id);
    });
    await this.delRosterCaches(pre.coach_id, clientProfileId, pre.id, workoutPlanIds, nutritionPlanIds);
    await CacheService.del(cacheKeys.profile(userId));
    return { message: "Successfully left coach" };
  }

  async removeClient(userId: string, clientId: string) {
    const coachProfileId = await this.getCoachProfileId(userId);
    const pre = await this.prisma.coach_clients.findFirst({
      where: { coach_id: coachProfileId, client_id: clientId },
      select: { id: true },
    });
    if (!pre) throw new ServiceError("client_not_assigned", 404);
    const { workoutPlanIds, nutritionPlanIds } = await this.assignmentPlanIds(pre.id);
    await this.prisma.$transaction(async (tx) => {
      const cc = await tx.coach_clients.findFirst({
        where: { coach_id: coachProfileId, client_id: clientId },
        select: { id: true },
      });
      if (!cc) throw new ServiceError("client_not_assigned", 404);
      await this.deleteCoachClientCascade(tx, cc.id);
    });
    await this.delRosterCaches(coachProfileId, clientId, pre.id, workoutPlanIds, nutritionPlanIds);
    const clientUser = await this.prisma.client_profiles
      .findUnique({ where: { id: clientId }, select: { user_id: true } })
      .catch(() => null);
    if (clientUser) await CacheService.del(cacheKeys.profile(clientUser.user_id));
    return { message: "Client removed from roster" };
  }
}
