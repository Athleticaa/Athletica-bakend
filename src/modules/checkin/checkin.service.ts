import { Prisma, PrismaClient } from "@prisma/client";
import { v2 as cloudinary } from "cloudinary";
import { injectable, inject } from "tsyringe";
import { PrismaClientToken } from "../../di/tokens";
import { ServiceError } from "../../lib/service-error";
import type { CreateQuestionInput, UpdateQuestionInput, SubmitAnswerItem } from "./checkin.validation";
import { PushService } from "../../services/push";
import { NotificationsService } from "../notifications/notifications.service";
import { withActorData } from "../notifications/notification-actor";
import i18next from "../../lib/i18n";
import { config } from "../../config";
import { CacheService, CacheHit, cacheKeys } from "../../lib/cache";
import { withTimeout } from "../../lib/with-timeout";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

type CheckinQuestion = Prisma.checkin_questionsGetPayload<Record<string, never>>;

@injectable()
export class CheckInService {
  constructor(
    @inject(PrismaClientToken) private prisma: PrismaClient,
    @inject(PushService) private push?: PushService,
    @inject(NotificationsService) private inbox?: NotificationsService,
  ) {}

  /** Best-effort inbox + push. Never throws. */
  private async notifyClientOfAssignment(
    coachProfileId: string,
    clientProfileId: string,
    assignmentId: string,
  ) {
    try {
      const [coach, client] = await withTimeout(
        Promise.all([
          this.prisma.coach_profiles.findFirst({
            where: { id: coachProfileId },
            select: {
              profile_image: true,
              user: { select: { id: true, username: true } },
            },
          }),
          this.prisma.client_profiles.findFirst({
            where: { id: clientProfileId },
            select: { user_id: true },
          }),
        ]),
        config.push.dbLookupTimeoutMs,
        "notify_lookup_timeout",
      );
      if (!client) return;
      const t = (key: string, opts?: Record<string, string>) =>
        i18next.t(key, { lng: "en", ...opts });
      const title = t("push_checkin_requested_title");
      const body = t("push_checkin_requested_body", {
        coach: coach?.user?.username ?? "Your coach",
      });
      const data = withActorData(
        {
          type: "checkin_requested",
          assignmentId,
          click_action: "FLUTTER_NOTIFICATION_CLICK",
        },
        {
          userId: coach?.user?.id,
          username: coach?.user?.username,
          profileImage: coach?.profile_image ?? undefined,
          role: "coach",
        },
      );
      let notificationId: string | undefined;
      if (this.inbox) {
        try {
          const row = await withTimeout(
            this.inbox.create(client.user_id, {
              type: "checkin_requested",
              title,
              body,
              data,
            }),
            config.push.dbLookupTimeoutMs,
            "inbox_create_timeout",
          );
          notificationId = row.id;
        } catch (err) {
          const reason = err instanceof Error ? err.message : "unknown";
          console.error(`[checkin] inbox persist failed reason=${reason}`);
        }
      }
      if (!this.push) return;
      await this.push.sendToUser(client.user_id, {
        title,
        body,
        data: notificationId ? { ...data, notificationId } : data,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : "unknown";
      console.error(`[checkin] assign push failed reason=${reason}`);
    }
  }

  /** Best-effort inbox + push. Never throws. */
  private async notifyCoachOfSubmission(
    coachProfileId: string,
    clientProfileId: string,
    submissionId: string,
  ) {
    try {
      const [coach, client] = await withTimeout(
        Promise.all([
          this.prisma.coach_profiles.findFirst({
            where: { id: coachProfileId },
            select: { user_id: true },
          }),
          this.prisma.client_profiles.findFirst({
            where: { id: clientProfileId },
            select: {
              profile_image: true,
              user: { select: { id: true, username: true } },
            },
          }),
        ]),
        config.push.dbLookupTimeoutMs,
        "notify_lookup_timeout",
      );
      if (!coach) return;
      const t = (key: string, opts?: Record<string, string>) =>
        i18next.t(key, { lng: "en", ...opts });
      const title = t("push_checkin_submitted_title");
      const body = t("push_checkin_submitted_body", {
        client: client?.user?.username ?? "A client",
      });
      const data = withActorData(
        {
          type: "checkin_submitted",
          submissionId,
          click_action: "FLUTTER_NOTIFICATION_CLICK",
        },
        {
          userId: client?.user?.id,
          username: client?.user?.username,
          profileImage: client?.profile_image ?? undefined,
          role: "client",
        },
      );
      let notificationId: string | undefined;
      if (this.inbox) {
        try {
          const row = await withTimeout(
            this.inbox.create(coach.user_id, {
              type: "checkin_submitted",
              title,
              body,
              data,
            }),
            config.push.dbLookupTimeoutMs,
            "inbox_create_timeout",
          );
          notificationId = row.id;
        } catch (err) {
          const reason = err instanceof Error ? err.message : "unknown";
          console.error(`[checkin] inbox persist failed reason=${reason}`);
        }
      }
      if (!this.push) return;
      await this.push.sendToUser(coach.user_id, {
        title,
        body,
        data: notificationId ? { ...data, notificationId } : data,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : "unknown";
      console.error(`[checkin] submit push failed reason=${reason}`);
    }
  }

  // ── Shared helpers ────────────────────────────────────────────────────────

  async getCoachProfileId(userId: string): Promise<string> {
    const profile = await this.prisma.coach_profiles.findFirst({ where: { user_id: userId } });
    if (!profile) throw new ServiceError("coach_profile_not_found", 404);
    return profile.id;
  }

  async getClientProfileId(userId: string): Promise<string> {
    const profile = await this.prisma.client_profiles.findFirst({ where: { user_id: userId } });
    if (!profile) throw new ServiceError("client_profile_not_found", 404);
    return profile.id;
  }

  /** Returns the coach_profile_id that the client is currently assigned to */
  private async getClientCoachId(clientProfileId: string): Promise<string> {
    const cc = await this.prisma.coach_clients.findFirst({
      where:  { client_id: clientProfileId },
      select: { coach_id: true },
    });
    if (!cc) throw new ServiceError("no_coach_assigned", 404);
    return cc.coach_id;
  }

  // ── Coach: question management ────────────────────────────────────────────

  async getMyQuestions(coachProfileId: string): Promise<CacheHit<CheckinQuestion[]>> {
    return CacheService.getOrSet(
      cacheKeys.checkinQuestions(coachProfileId),
      config.cache.ttlSec.checkinQuestions,
      () => this.loadCoachQuestions(coachProfileId),
    );
  }

  private loadCoachQuestions(coachProfileId: string): Promise<CheckinQuestion[]> {
    return this.prisma.checkin_questions.findMany({
      where:   { coach_id: coachProfileId },
      orderBy: { order: "asc" },
    });
  }

  /** Drop the coach set + all client views after any question mutation. */
  private async invalidateQuestionCaches(coachProfileId: string): Promise<void> {
    await CacheService.del(cacheKeys.checkinQuestions(coachProfileId));
    await CacheService.delByPrefix(cacheKeys.checkinClientQuestionsPrefix());
  }

  async createQuestion(coachProfileId: string, input: CreateQuestionInput) {
    // Determine next order position if not supplied
    let nextOrder = input.order;
    if (nextOrder === undefined) {
      const agg = await this.prisma.checkin_questions.aggregate({
        where: { coach_id: coachProfileId },
        _max:  { order: true },
      });
      nextOrder = (agg._max.order ?? 0) + 1;
    }

    const created = await this.prisma.checkin_questions.create({
      data: {
        coach_id: coachProfileId,
        question: input.question.trim(),
        type:     input.type,
        options:  input.options ?? [],
        required: input.required ?? true,
        order:    nextOrder,
      },
    });
    await this.invalidateQuestionCaches(coachProfileId);
    return created;
  }

  async updateQuestion(coachProfileId: string, questionId: string, input: UpdateQuestionInput) {
    const existing = await this.prisma.checkin_questions.findFirst({
      where: { id: questionId, coach_id: coachProfileId },
    });
    if (!existing) throw new ServiceError("checkin_question_not_found", 404);

    const updated = await this.prisma.checkin_questions.update({
      where: { id: questionId },
      data: {
        ...(input.question !== undefined && { question: input.question.trim() }),
        ...(input.type     !== undefined && { type:     input.type }),
        ...(input.options  !== undefined && { options:  input.options }),
        ...(input.required !== undefined && { required: input.required }),
        ...(input.order    !== undefined && { order:    input.order }),
      },
    });
    await this.invalidateQuestionCaches(coachProfileId);
    return updated;
  }

  async deleteQuestion(coachProfileId: string, questionId: string) {
    const existing = await this.prisma.checkin_questions.findFirst({
      where: { id: questionId, coach_id: coachProfileId },
    });
    if (!existing) throw new ServiceError("checkin_question_not_found", 404);

    // Enforce: must keep at least one question
    const count = await this.prisma.checkin_questions.count({
      where: { coach_id: coachProfileId },
    });
    if (count <= 1) throw new ServiceError("checkin_cannot_delete_last_question", 400);

    await this.prisma.checkin_questions.delete({ where: { id: questionId } });
    await this.invalidateQuestionCaches(coachProfileId);
    return { deleted: true };
  }

  async reorderQuestions(coachProfileId: string, orderedIds: string[]) {
    // Verify all provided IDs belong to this coach and the list is complete
    const questions = await this.prisma.checkin_questions.findMany({
      where:  { coach_id: coachProfileId },
      select: { id: true },
    });
    const ownedIds = new Set(questions.map((q) => q.id));

    if (
      orderedIds.length !== ownedIds.size ||
      orderedIds.some((id) => !ownedIds.has(id))
    ) {
      throw new ServiceError("checkin_reorder_ids_mismatch", 400);
    }

    // Update each question's order in a transaction
    await this.prisma.$transaction(
      orderedIds.map((id, index) =>
        this.prisma.checkin_questions.update({
          where: { id },
          data:  { order: index + 1 },
        })
      )
    );

    // Refresh-through: the response IS the full set — repopulate the coach key
    // directly and drop client views (their gating may reference new order).
    const fresh = await this.loadCoachQuestions(coachProfileId);
    await CacheService.setJson(
      cacheKeys.checkinQuestions(coachProfileId),
      fresh,
      config.cache.ttlSec.checkinQuestions,
    );
    await CacheService.delByPrefix(cacheKeys.checkinClientQuestionsPrefix());
    return fresh;
  }

  // ── Coach: view client submissions ────────────────────────────────────────

  async getClientSubmissions(coachProfileId: string, coachClientId: string) {
    return CacheService.getOrSet(
      cacheKeys.checkinCoachSubmissions(coachProfileId, coachClientId),
      config.cache.ttlSec.checkinSubmissions,
      () => this.loadClientSubmissions(coachProfileId, coachClientId),
    );
  }

  private async loadClientSubmissions(coachProfileId: string, coachClientId: string) {
    const cc = await this.prisma.coach_clients.findFirst({
      where: { id: coachClientId, coach_id: coachProfileId },
    });
    if (!cc) throw new ServiceError("client_not_assigned_to_coach", 404);

    return this.prisma.checkin_submissions.findMany({
      // OR-branch keeps pre-backfill rows (coach_client_id NULL) visible
      where: {
        OR: [
          { coach_client_id: coachClientId },
          { coach_id: coachProfileId, client_id: cc.client_id },
        ],
      },
      orderBy: { submitted_at: "desc" },
      select:  { id: true, submitted_at: true },
    });
  }

  async getClientCheckinStatus(coachProfileId: string, coachClientId: string) {
    const cc = await this.prisma.coach_clients.findFirst({
      where: { id: coachClientId, coach_id: coachProfileId },
    });
    if (!cc) throw new ServiceError("client_not_assigned_to_coach", 404);

    // OR-branch keeps pre-backfill rows (coach_client_id NULL) visible
    const submissionWhere = {
      OR: [
        { coach_client_id: coachClientId },
        { coach_id: coachProfileId, client_id: cc.client_id },
      ],
    };

    const [pending, submissionsCount, latest] = await Promise.all([
      this.prisma.checkin_assignments.findFirst({
        where: { status: "pending", OR: submissionWhere.OR },
        select: { id: true },
      }),
      this.prisma.checkin_submissions.count({ where: submissionWhere }),
      this.prisma.checkin_submissions.findFirst({
        where: submissionWhere,
        orderBy: { submitted_at: "desc" },
        select: { submitted_at: true },
      }),
    ]);

    return {
      coach_client_id: coachClientId,
      has_pending: !!pending,
      submissions_count: submissionsCount,
      last_submitted_at: latest?.submitted_at ?? null,
      answered: submissionsCount > 0,
    };
  }

  async getSubmissionDetail(coachProfileId: string, coachClientId: string, submissionId: string) {
    const cc = await this.prisma.coach_clients.findFirst({
      where: { id: coachClientId, coach_id: coachProfileId },
      select: { client_id: true },
    });
    if (!cc) throw new ServiceError("client_not_assigned_to_coach", 404);

    return CacheService.getOrSet(
      cacheKeys.checkinCoachSubmissionDetail(coachProfileId, coachClientId, submissionId),
      config.cache.ttlSec.checkinSubmissionDetail,
      () => this.loadSubmissionDetail(coachProfileId, coachClientId, cc.client_id, submissionId),
    );
  }

  private async loadSubmissionDetail(
    coachProfileId: string,
    coachClientId: string,
    clientProfileId: string,
    submissionId: string,
  ) {
    const submission = await this.prisma.checkin_submissions.findFirst({
      where: {
        id: submissionId,
        // OR-branch keeps pre-backfill rows (coach_client_id NULL) visible
        OR: [
          { coach_client_id: coachClientId },
          { coach_id: coachProfileId, client_id: clientProfileId },
        ],
      },
      include: {
        client: {
          include: { user: { select: { username: true, email: true } } },
        },
        answers: true,
      },
    });
    if (!submission) throw new ServiceError("checkin_submission_not_found", 404);
    // Prisma cannot order by nested JSON (question_snapshot.order);
    // Postgres sorts JSONB by keys (options before order), scrambling results.
    // Sort in memory by snapshot order.
    submission.answers.sort((a, b) => {
      const ordA = (a.question_snapshot as unknown as { order?: number })?.order ?? 0;
      const ordB = (b.question_snapshot as unknown as { order?: number })?.order ?? 0;
      return ordA - ordB;
    });
    return submission;
  }

  // ── Client: get coach's active questions ──────────────────────────────────
  // Gated on a pending assignment: returns [] when there is nothing to answer.

  async getCoachQuestionsForClient(clientProfileId: string): Promise<CacheHit<CheckinQuestion[]>> {
    return CacheService.getOrSet(
      cacheKeys.checkinClientQuestions(clientProfileId),
      config.cache.ttlSec.checkinClientQuestions,
      () => this.loadCoachQuestionsForClient(clientProfileId),
    );
  }

  private async loadCoachQuestionsForClient(clientProfileId: string): Promise<CheckinQuestion[]> {
    const coachId = await this.getClientCoachId(clientProfileId);

    const cc = await this.prisma.coach_clients.findFirst({
      where:  { client_id: clientProfileId },
      select: { id: true, coach_id: true },
    });
    if (!cc) throw new ServiceError("no_coach_assigned", 404);

    // No pending assignment → nothing to answer (200 with empty list)
    // (OR-branch keeps pre-backfill rows with coach_client_id NULL working)
    const pending = await this.prisma.checkin_assignments.findFirst({
      where: {
        status: "pending",
        OR: [
          { coach_client_id: cc.id },
          { coach_id: cc.coach_id, client_id: clientProfileId },
        ],
      },
      select: { id: true },
    });
    if (!pending) return [];

    return this.prisma.checkin_questions.findMany({
      where:   { coach_id: coachId },
      orderBy: { order: "asc" },
    });
  }

  // ── Client: submit a check-in ─────────────────────────────────────────────

  async submitCheckIn(
    clientProfileId: string,
    answers: SubmitAnswerItem[],
    uploadedImages: Record<string, string> // question_id → Cloudinary secure_url
  ) {
    const coachId = await this.getClientCoachId(clientProfileId);

    const cc = await this.prisma.coach_clients.findFirst({
      where: { client_id: clientProfileId, coach_id: coachId },
    });
    if (!cc) throw new ServiceError("client_not_assigned_to_coach", 404);

    // Gate: client must have a pending assignment from coach
    // (OR-branch keeps pre-backfill rows with coach_client_id NULL working)
    const pending = await this.prisma.checkin_assignments.findFirst({
      where: {
        status: "pending",
        OR: [
          { coach_client_id: cc.id },
          { coach_id: coachId, client_id: clientProfileId },
        ],
      },
      select: { id: true, coach_client_id: true },
    });
    if (!pending) throw new ServiceError("checkin_no_pending_assignment", 403);

    // Load all active questions for this coach (ordered)
    const questions = await this.prisma.checkin_questions.findMany({
      where:   { coach_id: coachId },
      orderBy: { order: "asc" },
    });

    // Merge text answers and image answers into one map
    const answersMap = new Map<string, string>();
    for (const a of answers) {
      answersMap.set(a.question_id, String(a.answer_value));
    }
    for (const [qId, url] of Object.entries(uploadedImages)) {
      answersMap.set(qId, url);
    }

    // Validate: every required question must have an answer
    const missingIds: string[] = [];
    for (const q of questions) {
      if (!q.required) continue;
      const val = answersMap.get(q.id);
      if (val === undefined || val.trim() === "") missingIds.push(q.id);
    }
    if (missingIds.length > 0) {
      throw new ServiceError("checkin_missing_required_answers", 400, { missing: missingIds });
    }

    // Validate: answers must only reference questions belonging to this coach
    const validIds = new Set(questions.map((q) => q.id));
    for (const a of answers) {
      if (!validIds.has(a.question_id)) {
        throw new ServiceError("checkin_invalid_question_id", 400);
      }
    }
    for (const qId of Object.keys(uploadedImages)) {
      if (!validIds.has(qId)) {
        throw new ServiceError("checkin_invalid_question_id", 400);
      }
    }

    // Validate each answer value against its question type
    // Blank optional answers are skipped and omitted from persisted answers.
    for (const q of questions) {
      const val = answersMap.get(q.id);
      if (val === undefined) continue; // optional unanswered question — already caught above if required
      if (!q.required && val.trim() === "") {
        answersMap.delete(q.id);
        continue;
      }
      this.validateAnswerValue(q as { id: string; type: string; options: string[] }, val);
    }

    // Persist: create submission + all answer rows + consume assignment atomically
    const submission = await this.prisma.$transaction(async (tx) => {
      const sub = await tx.checkin_submissions.create({
        data: { coach_id: coachId, client_id: clientProfileId, coach_client_id: cc.id },
      });

      const answerData = questions
        .filter((q) => answersMap.has(q.id))
        .map((q) => ({
          submission_id:     sub.id,
          question_id:       q.id,
          answer_value:      answersMap.get(q.id)!,
          question_snapshot: {
            question: q.question,
            type:     q.type,
            options:  q.options,
            required: q.required,
            order:    q.order,
          },
        }));

      await tx.checkin_answers.createMany({ data: answerData });
      // Consume pending assignment after successful submission — delete the exact
      // row that gated the request (avoids no-op when OR+status drifts) and also
      // clean any duplicate legacy pending that would keep has_pending true.
      try {
        await tx.checkin_assignments.delete({ where: { id: pending.id } });
      } catch {
        // fallback if the row was already removed / id mismatch (legacy NULL case)
        await tx.checkin_assignments.deleteMany({
          where: {
            status: "pending",
            OR: [
              { coach_client_id: cc.id },
              { coach_id: coachId, client_id: clientProfileId },
            ],
          },
        });
      }
      // final sweep for any duplicate pending (e.g. legacy NULL row alongside the gated one)
      await tx.checkin_assignments.deleteMany({
        where: {
          status: "pending",
          OR: [
            { coach_client_id: cc.id },
            { coach_id: coachId, client_id: clientProfileId },
          ],
        },
      });
      return sub;
    });

    await this.notifyCoachOfSubmission(coachId, clientProfileId, submission.id);

    // Submission consumes the pending assignment → gated view flips back to [].
    // A new submission row also changes both submission lists.
    await CacheService.del(cacheKeys.checkinClientQuestions(clientProfileId));
    await CacheService.del(cacheKeys.hasassign(clientProfileId));
    await CacheService.del(cacheKeys.checkinSubmissions(clientProfileId));
    await CacheService.delByPrefix(cacheKeys.checkinCoachSubmissionsPrefix(coachId));

    return submission;
  }

  private validateAnswerValue(
    q: { id: string; type: string; options: string[] },
    val: string
  ): void {
    switch (q.type) {
      case "NUMBER": {
        // Strict: non-negative plain number only. Rejects "75kg", "Infinity", "", "  ".
        if (!/^\d+(\.\d+)?$/.test(val.trim())) throw new ServiceError("checkin_invalid_number_answer", 400);
        break;
      }
      case "RATING": {
        // Strict: integer 1-10 only. Rejects "5.8", "5stars", "0", "11".
        if (!/^(?:[1-9]|10)$/.test(val.trim())) throw new ServiceError("checkin_invalid_rating_answer", 400);
        break;
      }
      case "YES_NO":
      case "SINGLE_CHOICE": {
        if (!q.options.includes(val)) throw new ServiceError("checkin_invalid_choice_answer", 400);
        break;
      }
      case "TEXT": {
        if (val.trim().length === 0) throw new ServiceError("checkin_text_answer_empty", 400);
        break;
      }
      case "IMAGE":
        // URL already set by controller after successful Cloudinary upload
        break;
    }
  }

  // ── Client: view own submissions ──────────────────────────────────────────

  async getMySubmissions(clientProfileId: string) {
    return CacheService.getOrSet(
      cacheKeys.checkinSubmissions(clientProfileId),
      config.cache.ttlSec.checkinSubmissions,
      () => this.loadMySubmissions(clientProfileId),
    );
  }

  private async loadMySubmissions(clientProfileId: string) {
    return this.prisma.checkin_submissions.findMany({
      where:   { client_id: clientProfileId },
      orderBy: { submitted_at: "desc" },
      select:  { id: true, submitted_at: true, coach_id: true, coach_client_id: true },
    });
  }

  async getMySubmissionDetail(clientProfileId: string, submissionId: string) {
    return CacheService.getOrSet(
      cacheKeys.checkinSubmissionDetail(clientProfileId, submissionId),
      config.cache.ttlSec.checkinSubmissionDetail,
      () => this.loadMySubmissionDetail(clientProfileId, submissionId),
    );
  }

  private async loadMySubmissionDetail(clientProfileId: string, submissionId: string) {
    const submission = await this.prisma.checkin_submissions.findFirst({
      where: { id: submissionId, client_id: clientProfileId },
      include: {
        answers: true,
      },
    });
    if (!submission) throw new ServiceError("checkin_submission_not_found", 404);
    // Prisma cannot order by nested JSON (question_snapshot.order) — sort in memory.
    submission.answers.sort((a, b) => {
      const ordA = (a.question_snapshot as unknown as { order?: number })?.order ?? 0;
      const ordB = (b.question_snapshot as unknown as { order?: number })?.order ?? 0;
      return ordA - ordB;
    });
    return submission;
  }

  // ── Check-In assignments ──────────────────────────────────────────────────

  async assignCheckIn(coachProfileId: string, coachClientId: string) {
    const cc = await this.prisma.coach_clients.findFirst({
      where: { id: coachClientId, coach_id: coachProfileId },
    });
    if (!cc) throw new ServiceError("client_not_assigned_to_coach", 404);

    const assignment = await this.prisma.checkin_assignments.upsert({
      where: {
        coach_client_id: coachClientId,
      },
      update: { status: "pending", updated_at: new Date() },
      create: { coach_id: coachProfileId, client_id: cc.client_id, coach_client_id: coachClientId, status: "pending" },
    });

    await this.notifyClientOfAssignment(coachProfileId, cc.client_id, assignment.id);

    // A (new) pending assignment flips the client's gated question view.
    await CacheService.del(cacheKeys.checkinClientQuestions(cc.client_id));
    await CacheService.del(cacheKeys.hasassign(cc.client_id));

    return assignment;
  }

  async hasPendingAssignment(clientProfileId: string): Promise<CacheHit<boolean>> {
    return CacheService.getOrSet(
      cacheKeys.hasassign(clientProfileId),
      config.cache.ttlSec.hasassign,
      () => this.loadHasPendingAssignment(clientProfileId),
    );
  }

  private async loadHasPendingAssignment(clientProfileId: string): Promise<boolean> {
    const cc = await this.prisma.coach_clients.findFirst({
      where:  { client_id: clientProfileId },
      select: { id: true, coach_id: true },
    });
    if (!cc) throw new ServiceError("no_coach_assigned", 404);
    const assignment = await this.prisma.checkin_assignments.findFirst({
      // OR-branch keeps pre-backfill rows (coach_client_id NULL) visible
      where: {
        status: "pending",
        OR: [
          { coach_client_id: cc.id },
          { coach_id: cc.coach_id, client_id: clientProfileId },
        ],
      },
      select: { id: true },
    });
    return !!assignment;
  }

  async getPendingAssignment(clientProfileId: string) {
    const cc = await this.prisma.coach_clients.findFirst({
      where:  { client_id: clientProfileId },
      select: { id: true, coach_id: true },
    });
    if (!cc) throw new ServiceError("no_coach_assigned", 404);
    return this.prisma.checkin_assignments.findFirst({
      where: {
        status: "pending",
        OR: [
          { coach_client_id: cc.id },
          { coach_id: cc.coach_id, client_id: clientProfileId },
        ],
      },
    });
  }

  // ── Cloudinary upload (same pattern as profile.service.ts) ────────────────

  async uploadCheckInPhoto(file: Express.Multer.File): Promise<string> {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: "athletica/checkins", resource_type: "image" },
        (error, result) => {
          if (error || !result) return reject(error ?? new Error("Upload failed"));
          resolve(result.secure_url);
        }
      );
      stream.end(file.buffer);
    });
  }
}
