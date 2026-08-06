import { PrismaClient } from "@prisma/client";
import { injectable, container } from "tsyringe";
import { PrismaClientToken } from "../../di/tokens";
import { ServiceError } from "../../lib/service-error";
import type { AnswerItem } from "./client-questions.validation";

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

    if (answers.length === 0) return [];

    const questionIds = answers.map((a) => a.question_id);
    const answeredQuestions = await this.prisma.client_questions.findMany({
      where: { id: { in: questionIds } },
      select: { id: true, group_key: true, choices: true },
    });

    const groupKeys = answeredQuestions.map((q) => q.group_key);
    const langQuestions = await this.prisma.client_questions.findMany({
      where: { group_key: { in: groupKeys }, language },
      select: { group_key: true, question: true, choices: true },
    });

    const langByGroup = new Map(langQuestions.map((q) => [q.group_key, q]));
    const groupByQuestion = new Map(answeredQuestions.map((q) => [q.id, q.group_key]));

    return answers.map((a) => {
      const groupKey = groupByQuestion.get(a.question_id)!;
      const langQ = langByGroup.get(groupKey);
      return {
        id: a.id,
        client_id: a.client_id,
        question_id: a.question_id,
        answer: a.answer,
        answer_text: langQ?.choices[a.answer as number] ?? null,
        created_at: a.created_at,
        question: langQ?.question ?? null,
      };
    });
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
      select: { id: true, choices: true },
    });

    const questionMap = new Map(questions.map((q) => [q.id, q]));
    const invalid = answers.filter((a) => !questionMap.has(a.question_id));
    if (invalid.length > 0) {
      throw new ServiceError("invalid_question_ids", 400);
    }

    const outOfRange = answers.filter((a) => {
      const q = questionMap.get(a.question_id)!;
      return a.answer < 0 || a.answer >= q.choices.length;
    });
    if (outOfRange.length > 0) {
      throw new ServiceError("answer_out_of_range", 400);
    }

    const data = answers.map((a) => ({
      client_id: clientId,
      question_id: a.question_id,
      answer: a.answer,
    }));

    await this.prisma.client_answers.createMany({ data });
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
      select: { id: true, choices: true },
    });

    const questionMap = new Map(questions.map((q) => [q.id, q]));
    const outOfRange = answers.filter((a) => {
      const q = questionMap.get(a.question_id);
      if (!q) return true;
      return a.answer < 0 || a.answer >= q.choices.length;
    });
    if (outOfRange.length > 0) {
      throw new ServiceError("answer_out_of_range", 400);
    }

    for (const item of answers) {
      await this.prisma.client_answers.updateMany({
        where: { client_id: clientId, question_id: item.question_id },
        data: { answer: item.answer },
      });
    }
  }
}
