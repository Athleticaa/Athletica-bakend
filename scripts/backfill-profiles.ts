import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { getHeightWeightQuestionIds, parseHeightWeightAnswer } from "../src/modules/client-questions/height-weight.util";
import { getGenderGoalQuestionIds } from "../src/modules/client-questions/gender-goal.util";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const GENDER_MAP: Record<string, string> = { Male: "male", Female: "female", "ذكر": "male", "أنثى": "female" };
const GOAL_MAP: Record<string, string> = {
  "Lose weight": "lose_weight", "Build muscle": "build_muscle", "Improve overall fitness": "improve_fitness", "Increase strength": "increase_strength", "Rehabilitation / injury recovery": "rehabilitation",
  "إنقاص الوزن": "lose_weight", "بناء العضلات": "build_muscle", "تحسين اللياقة البدنية العامة": "improve_fitness", "زيادة القوة": "increase_strength", "إعادة التأهيل / التعافي من الإصابات": "rehabilitation",
};

async function main() {
  console.log("Resolving question IDs (height/weight + gender/goal, no cache)...");
  const { heightIds, weightIds } = await getHeightWeightQuestionIds(prisma, { forceRefresh: true });
  const { genderIds, goalIds, genderChoices, goalChoices } = await getGenderGoalQuestionIds(prisma);

  console.log(`Height IDs: ${heightIds.size}, Weight IDs: ${weightIds.size}, Gender IDs: ${genderIds.size}, Goal IDs: ${goalIds.size}`);

  const allIds = [...heightIds, ...weightIds, ...genderIds, ...goalIds];
  if (allIds.length === 0) {
    console.warn("No questions found. Did you run `npx prisma db seed`?");
    return;
  }

  const answers = await prisma.client_answers.findMany({
    where: { question_id: { in: allIds } },
    select: { client_id: true, question_id: true, answer: true },
  });

  if (answers.length === 0) {
    console.log("No answers for height/weight/gender/goal — nothing to backfill.");
    return;
  }

  const byClient = new Map<string, { height?: number; weight?: number; gender?: string; goal?: string }>();

  for (const a of answers) {
    const cur = byClient.get(a.client_id) ?? {};
    if (heightIds.has(a.question_id)) {
      const v = parseHeightWeightAnswer(a.answer);
      if (v !== null) cur.height = v;
    } else if (weightIds.has(a.question_id)) {
      const v = parseHeightWeightAnswer(a.answer);
      if (v !== null) cur.weight = v;
    } else if (genderIds.has(a.question_id)) {
      const choices = genderChoices.get(a.question_id);
      if (choices) {
        const idx = parseInt(a.answer, 10);
        const raw = choices[idx];
        if (raw !== undefined) cur.gender = GENDER_MAP[raw] ?? raw.toLowerCase().trim();
      }
    } else if (goalIds.has(a.question_id)) {
      const choices = goalChoices.get(a.question_id);
      if (choices) {
        const idx = parseInt(a.answer, 10);
        const raw = choices[idx];
        if (raw !== undefined) cur.goal = GOAL_MAP[raw] ?? raw.toLowerCase().replace(/\s+/g, "_");
      }
    }
    byClient.set(a.client_id, cur);
  }

  console.log(`Found ${byClient.size} clients with parseable answers.`);
  let updated = 0;
  for (const [clientId, patch] of byClient.entries()) {
    if (
      patch.height === undefined &&
      patch.weight === undefined &&
      patch.gender === undefined &&
      patch.goal === undefined
    )
      continue;
    // Filter empty to avoid overwriting with undefined
    const data: Record<string, any> = {};
    if (patch.height !== undefined) data.height = patch.height;
    if (patch.weight !== undefined) data.weight = patch.weight;
    if (patch.gender !== undefined) data.gender = patch.gender;
    if (patch.goal !== undefined) data.goal = patch.goal;
    if (Object.keys(data).length === 0) continue;
    try {
      await prisma.client_profiles.update({ where: { id: clientId }, data });
      updated++;
      console.log(`  updated ${clientId} -> ${JSON.stringify(data)}`);
    } catch (e) {
      console.error(`  failed ${clientId}:`, e);
    }
  }
  console.log(`Backfill complete: ${updated} client_profiles updated.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => prisma.$disconnect());
