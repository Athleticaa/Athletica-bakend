import { PrismaClient } from "@prisma/client";

export const GENDER_QUESTION_TEXTS = ["What is your gender?", "ما هو جنسك؟"] as const;
export const GOAL_QUESTION_TEXTS = ["What are your primary fitness goals?", "ما هي أهدافك الأساسية في اللياقة البدنية؟"] as const;

const GOAL_MAP: Record<string, string> = {
  "Lose weight": "lose_weight",
  "Build muscle": "build_muscle",
  "Improve overall fitness": "improve_fitness",
  "Increase strength": "increase_strength",
  "Rehabilitation / injury recovery": "rehabilitation",
  // Arabic choices → same canonical values
  "إنقاص الوزن": "lose_weight",
  "بناء العضلات": "build_muscle",
  "تحسين اللياقة البدنية العامة": "improve_fitness",
  "زيادة القوة": "increase_strength",
  "إعادة التأهيل / التعافي من الإصابات": "rehabilitation",
};

const GENDER_MAP: Record<string, string> = {
  Male: "male",
  Female: "female",
  ذكر: "male",
  أنثى: "female",
};

/**
 * Resolve question IDs for gender/goal using group_key indirection (bilingual).
 * No cache — fresh DB lookup each call (write-through requirement).
 */
export async function getGenderGoalQuestionIds(prisma: PrismaClient) {
  const [genderGroups, goalGroups] = await Promise.all([
    prisma.client_questions.findMany({
      where: { question: { in: [...GENDER_QUESTION_TEXTS] }, question_type: "choice" },
      select: { group_key: true },
    }),
    prisma.client_questions.findMany({
      where: { question: { in: [...GOAL_QUESTION_TEXTS] }, question_type: "choice" },
      select: { group_key: true },
    }),
  ]);

  const genderKeys = genderGroups.map((r) => r.group_key);
  const goalKeys = goalGroups.map((r) => r.group_key);

  const [genderQs, goalQs] = await Promise.all([
    genderKeys.length
      ? prisma.client_questions.findMany({ where: { group_key: { in: genderKeys } }, select: { id: true, choices: true } })
      : Promise.resolve([] as { id: string; choices: string[] }[]),
    goalKeys.length
      ? prisma.client_questions.findMany({ where: { group_key: { in: goalKeys } }, select: { id: true, choices: true } })
      : Promise.resolve([] as { id: string; choices: string[] }[]),
  ]);

  return {
    genderIds: new Set(genderQs.map((q) => q.id)),
    goalIds: new Set(goalQs.map((q) => q.id)),
    genderChoices: new Map(genderQs.map((q) => [q.id, q.choices])),
    goalChoices: new Map(goalQs.map((q) => [q.id, q.choices])),
  };
}

/**
 * Given a batch of answers, return parsed gender/goal to sync to client_profiles.
 * Choice answer is index string/number → choices[idx] → canonical profile value.
 */
export async function resolveGenderGoalFromAnswers(
  prisma: PrismaClient,
  answers: { question_id: string; answer: string | number }[],
): Promise<{ gender?: string; goal?: string }> {
  if (answers.length === 0) return {};
  const { genderIds, goalIds, genderChoices, goalChoices } = await getGenderGoalQuestionIds(prisma);
  const out: { gender?: string; goal?: string } = {};

  for (const a of answers) {
    if (genderIds.has(a.question_id)) {
      const choices = genderChoices.get(a.question_id);
      if (!choices) continue;
      const idx = typeof a.answer === "number" ? a.answer : parseInt(String(a.answer), 10);
      const raw = choices[idx];
      if (raw !== undefined) {
        const mapped = GENDER_MAP[raw] ?? raw.toLowerCase().trim();
        if (mapped) out.gender = mapped;
      }
    } else if (goalIds.has(a.question_id)) {
      const choices = goalChoices.get(a.question_id);
      if (!choices) continue;
      const idx = typeof a.answer === "number" ? a.answer : parseInt(String(a.answer), 10);
      const raw = choices[idx];
      if (raw !== undefined) {
        const mapped = GOAL_MAP[raw] ?? raw.toLowerCase().replace(/\s+/g, "_");
        if (mapped) out.goal = mapped;
      }
    }
  }
  return out;
}
