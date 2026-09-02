import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { getHeightWeightQuestionIds, parseHeightWeightAnswer } from "../src/modules/client-questions/height-weight.util";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Resolving height/weight question IDs...");
  const { heightIds, weightIds } = await getHeightWeightQuestionIds(prisma, { forceRefresh: true });

  const allIds = [...heightIds, ...weightIds];
  if (allIds.length === 0) {
    console.warn("No height/weight questions found. Did you run `npx prisma db seed`?");
    return;
  }
  console.log(`Height IDs: ${heightIds.size}, Weight IDs: ${weightIds.size}`);

  // Fetch all answers for those questions
  const answers = await prisma.client_answers.findMany({
    where: { question_id: { in: allIds } },
    select: { client_id: true, question_id: true, answer: true },
  });

  if (answers.length === 0) {
    console.log("No height/weight answers found — nothing to backfill.");
    return;
  }

  // Group by client_id, keep last answer per type (ORDER by created_at asc not selected, but latest overwrite is fine)
  const byClient = new Map<string, { height?: number; weight?: number }>();
  for (const a of answers) {
    const isHeight = heightIds.has(a.question_id);
    const isWeight = weightIds.has(a.question_id);
    if (!isHeight && !isWeight) continue;
    const v = parseHeightWeightAnswer(a.answer);
    if (v === null) continue;
    const cur = byClient.get(a.client_id) ?? {};
    if (isHeight) cur.height = v;
    else cur.weight = v;
    byClient.set(a.client_id, cur);
  }

  console.log(`Found ${byClient.size} clients with parseable height/weight answers.`);

  let updated = 0;
  for (const [clientId, patch] of byClient.entries()) {
    if (patch.height === undefined && patch.weight === undefined) continue;
    try {
      await prisma.client_profiles.update({
        where: { id: clientId },
        data: patch,
      });
      updated++;
      console.log(`  updated ${clientId} -> ${JSON.stringify(patch)}`);
    } catch (e) {
      console.error(`  failed ${clientId}:`, e);
    }
  }

  console.log(`Backfill complete: ${updated} client_profiles updated.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
