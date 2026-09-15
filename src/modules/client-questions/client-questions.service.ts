import { PrismaClient } from "@prisma/client";
import { injectable, container } from "tsyringe";
import { PrismaClientToken } from "../../di/tokens";
import { ServiceError } from "../../lib/service-error";
import type { AnswerItem } from "./client-questions.validation";
import { resolveHeightWeightFromAnswers } from "./height-weight.util";
import { resolveGenderGoalFromAnswers } from "./gender-goal.util";

export { ServiceError };

@injectable()
export class ClientQuestionsService {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = container.resolve(PrismaClientToken);
  }

  async getQuestions(language: string) {
    return this.prisma.client_questions.findMany({
      where: { language },
      orderBy: { created_at: "asc" },
    });
  }

  async getTotalQuestions(language: string) {
    return this.prisma.client_questions.count({ where: { language } });
  }

  async getClientProfileId(userId: string) {
    const profile = await this.prisma.client_profiles.findFirst({
      where: { user_id: userId },
    });
    if (!profile) throw new ServiceError("client_profile_not_found", 404);
    return profile.id;
  }

  async getAnswers(clientId: string, language: string) {
    const answers = await this.prisma.client_answers.findMany({
      where: { client_id: clientId },
      orderBy: { created_at: "asc" },
    });

    if (answers.length === 0) return { answers: [], total: 0 };

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

    const mapped = answers.map((a) => {
      const groupKey = groupByQuestion.get(a.question_id);
      const langQ = groupKey ? langByGroup.get(groupKey) : undefined;
      const questionType = typeByQuestion.get(a.question_id);
      const isTextQuestion = questionType === "text";

      let answerText: string | null = null;
      if (isTextQuestion) {
        answerText = a.answer;
      } else {
        const choiceIndex = parseInt(a.answer, 10);
        answerText = !isNaN(choiceIndex) ? (langQ?.choices[choiceIndex] ?? null) : null;
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

    return { answers: mapped, total: distinctGroups.size };
  }

  async createAnswers(clientId: string, answers: AnswerItem[]) {
    const existing = await this.prisma.client_answers.findMany({
      where: { client_id: clientId, question_id: { in: answers.map((a) => a.question_id) } },
      select: { question_id: true },
    });

    if (existing.length > 0) {
      throw new ServiceError("answers_already_exist", 409);
    }

    const questions = await this.prisma.client_questions.findMany({
      where: { id: { in: answers.map((a) => a.question_id) } },
      select: { id: true, choices: true, question_type: true },
    });

    const questionMap = new Map(questions.map((q) => [q.id, q]));

    this.validateAnswersAgainstQuestions(answers, questionMap);

    const data = answers.map((a) => ({
      client_id: clientId,
      question_id: a.question_id,
      answer: String(a.answer),
    }));

    // Resolve profile sync patches before transaction (fresh lookups, no cache)
    const [hwPatch, ggPatch] = await Promise.all([
      resolveHeightWeightFromAnswers(this.prisma, answers),
      resolveGenderGoalFromAnswers(this.prisma, answers),
    ]);
    const profilePatch = { ...hwPatch, ...ggPatch };

    // Atomic: answers + profile sync together — no partial commit if second write fails
    await this.prisma.$transaction(async (tx) => {
      await tx.client_answers.createMany({ data });
      if (Object.keys(profilePatch).length > 0) {
        await tx.client_profiles.update({
          where: { id: clientId },
          data: profilePatch,
        });
      }
    });
  }

  async updateAnswers(clientId: string, answers: AnswerItem[]) {
    const existing = await this.prisma.client_answers.findMany({
      where: { client_id: clientId, question_id: { in: answers.map((a) => a.question_id) } },
      select: { question_id: true },
    });

    const existingSet = new Set(existing.map((e) => e.question_id));
    const notFound = answers.filter((a) => !existingSet.has(a.question_id));
    if (notFound.length > 0) {
      throw new ServiceError("answers_not_found", 404);
    }

    const questions = await this.prisma.client_questions.findMany({
      where: { id: { in: answers.map((a) => a.question_id) } },
      select: { id: true, choices: true, question_type: true },
    });

    const questionMap = new Map(questions.map((q) => [q.id, q]));

    this.validateAnswersAgainstQuestions(answers, questionMap);

    // Resolve profile sync patches before transaction
    const [hwPatch, ggPatch] = await Promise.all([
      resolveHeightWeightFromAnswers(this.prisma, answers),
      resolveGenderGoalFromAnswers(this.prisma, answers),
    ]);
    const profilePatch = { ...hwPatch, ...ggPatch };

    // Atomic: all answer updates + profile sync in one transaction
    await this.prisma.$transaction(async (tx) => {
      for (const item of answers) {
        await tx.client_answers.updateMany({
          where: { client_id: clientId, question_id: item.question_id },
          data: { answer: String(item.answer) },
        });
      }
      if (Object.keys(profilePatch).length > 0) {
        await tx.client_profiles.update({
          where: { id: clientId },
          data: profilePatch,
        });
      }
    });
  }

  /**
   * Validates that each answer is consistent with its question type:
   * - "choice" questions: answer must be a non-negative integer index within choices array bounds
   * - "text" questions: answer must be a non-empty string
   */
  private validateAnswersAgainstQuestions(
    answers: AnswerItem[],
    questionMap: Map<string, { id: string; choices: string[]; question_type: string }>
  ): void {
    const invalid = answers.filter((a) => !questionMap.has(a.question_id));
    if (invalid.length > 0) {
      throw new ServiceError("invalid_question_ids", 400);
    }

    for (const a of answers) {
      const q = questionMap.get(a.question_id)!;

      if (q.question_type === "text") {
        if (typeof a.answer !== "string" || a.answer.trim().length === 0) {
          throw new ServiceError("answer_text_required", 400);
        }
      } else {
        // choice question: answer must be a valid index
        const idx = typeof a.answer === "number" ? a.answer : parseInt(String(a.answer), 10);
        if (!Number.isInteger(idx) || idx < 0 || idx >= q.choices.length) {
          throw new ServiceError("answer_out_of_range", 400);
        }
      }
    }
  }
}
