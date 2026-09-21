import { PrismaClient } from "@prisma/client";

/**
 * Height/Weight question texts as seeded in prisma/seed.ts.
 * Bilingual pairs share the same group_key — resolving via group_key makes the lookup
 * language-proof and tolerant to future language additions.
 */
export const HEIGHT_QUESTION_TEXTS = ["Type Your Height", "أدخل طولك"] as const;
export const WEIGHT_QUESTION_TEXTS = ["Type Your Weight", "أدخل وزنك"] as const;

/**
 * Extract numeric value from free-text answer like "182 cm", "75kg", "82.5".
 * Returns null if not parseable or negative.
 */
export function parseHeightWeightAnswer(answer: string | number): number | null {
  const raw = String(answer).trim();
  if (!raw) return null;
  // Handle comma decimal "180,5" -> "180.5", keep minus for negative detection
  const normalized = raw.replace(/,/g, ".").replace(/[^0-9.-]/g, "");
  if (!normalized || normalized === "." || normalized === "-" || normalized === "-.") return null;
  const n = parseFloat(normalized);
  if (Number.isNaN(n) || !Number.isFinite(n) || n <= 0) return null;
  return n;
}

type QuestionIdSets = {
  heightIds: Set<string>;
  weightIds: Set<string>;
};

/**
 * Resolve all question IDs that correspond to height/weight text questions.
 * Uses group_key indirection so en/ar variants are both covered.
 * No cache — fresh DB lookup each call (write-through requirement).
 */
export async function getHeightWeightQuestionIds(
  prisma: PrismaClient,
  _opts?: { forceRefresh?: boolean },
): Promise<QuestionIdSets> {

  // Find group_keys for height and weight questions (en/ar)
  const [heightGroups, weightGroups] = await Promise.all([
    prisma.client_questions.findMany({
      where: { question: { in: [...HEIGHT_QUESTION_TEXTS] }, question_type: "text" },
      select: { group_key: true },
    }),
    prisma.client_questions.findMany({
      where: { question: { in: [...WEIGHT_QUESTION_TEXTS] }, question_type: "text" },
      select: { group_key: true },
    }),
  ]);

  const heightGroupKeys = heightGroups.map((r) => r.group_key);
  const weightGroupKeys = weightGroups.map((r) => r.group_key);

  // If seed hasn't been run in this env, fall back to empty sets (no crash)
  const [heightQuestions, weightQuestions] = await Promise.all([
    heightGroupKeys.length
      ? prisma.client_questions.findMany({
          where: { group_key: { in: heightGroupKeys } },
          select: { id: true },
        })
      : Promise.resolve([] as { id: string }[]),
    weightGroupKeys.length
      ? prisma.client_questions.findMany({
          where: { group_key: { in: weightGroupKeys } },
          select: { id: true },
        })
      : Promise.resolve([] as { id: string }[]),
  ]);

  const result: QuestionIdSets = {
    heightIds: new Set(heightQuestions.map((q) => q.id)),
    weightIds: new Set(weightQuestions.map((q) => q.id)),
  };

  return result;
}

/**
 * Given a batch of answers, return the parsed height/weight to sync to client_profiles
 * if any of those answers correspond to height/weight questions.
 */
export async function resolveHeightWeightFromAnswers(
  prisma: PrismaClient,
  answers: { question_id: string; answer: string | number }[],
): Promise<{ height?: number; weight?: number }> {
  if (answers.length === 0) return {};
  const { heightIds, weightIds } = await getHeightWeightQuestionIds(prisma);
  const out: { height?: number; weight?: number } = {};

  for (const a of answers) {
    if (heightIds.has(a.question_id)) {
      const v = parseHeightWeightAnswer(a.answer);
      if (v !== null) out.height = v;
    } else if (weightIds.has(a.question_id)) {
      const v = parseHeightWeightAnswer(a.answer);
      if (v !== null) out.weight = v;
    }
  }
  return out;
}

/** For testing: clear cache (no-op, kept for compat) */
export function __clearHeightWeightCache() {}
