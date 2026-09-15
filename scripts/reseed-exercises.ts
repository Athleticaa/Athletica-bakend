/**
 * reseed-exercises.ts
 *
 * Standalone reseed for the `exercises` catalog ONLY:
 *   1. Deletes dependent rows (FK RESTRICT) then clears `exercises`
 *   2. Re-inserts everything from exercises.json
 *
 * Run with:  npx tsx scripts/reseed-exercises.ts [--dry-run] [--file=./exercises.json]
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

function getArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

async function main() {
  const isDryRun = process.argv.includes("--dry-run");
  const fileArg = getArg("file") ?? "exercises.json";
  const exercisesPath = path.isAbsolute(fileArg)
    ? fileArg
    : path.join(process.cwd(), fileArg);

  if (isDryRun) console.log("🔎  Dry-run mode – no data will be changed.\n");

  if (!fs.existsSync(exercisesPath)) {
    console.error(`❌  File not found: ${exercisesPath}`);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(exercisesPath, "utf-8"));
  const rows = Array.isArray(raw) ? raw : raw.exercises ?? [];
  console.log(`📄  Loaded ${rows.length} exercises from ${exercisesPath}`);

  const invalid = rows.filter(
    (e: any) =>
      !e.id ||
      !e.name ||
      !Array.isArray(e.aliases) ||
      !e.shortDescription ||
      !e.instructions ||
      !Array.isArray(e.steps) ||
      !Array.isArray(e.formCues) ||
      !Array.isArray(e.commonMistakes) ||
      !e.breathing ||
      !e.videos ||
      !e.thumbnails
  );
  if (invalid.length > 0) {
    console.warn(
      `⚠️  ${invalid.length} rows missing name_en/name_ar (first: ${JSON.stringify(invalid[0]).slice(0, 200)})`
    );
  }

  const before = await prisma.exercises.count();
  console.log(`📊  exercises in DB before: ${before}`);

  if (isDryRun) {
    console.log("💡  Dry-run complete – skipping delete + insert.");
    return;
  }

  // 1. Clear dependents first (FK RESTRICT), then exercises
  console.log("🗑️  Clearing dependent rows + exercises...");
  await prisma.workout_exercise_logs.deleteMany({});
  await prisma.workout_day_exercises.deleteMany({});
  await prisma.workout_template_exercises.deleteMany({});
  await prisma.exercises.deleteMany({});
  console.log("✅  exercises table cleared.");

  // 2. Bulk insert fresh from JSON
  const generatedIds = await Promise.all(
    rows.map(() =>
      prisma.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT gen_random_uuid()::text AS id`
      )
    )
  );

  const data = rows.map((e: any, index: number) => ({
    id: generatedIds[index][0].id,
    name: e.name,
    aliases: e.aliases,
    bodyPart: e.bodyPart,
    target: e.target,
    secondaryMuscles: e.secondaryMuscles,
    equipment: e.equipment,
    difficulty: e.difficulty,
    muscleGroup: e.muscleGroup,
    compound: e.compound,
    unilateral: e.unilateral,
    shortDescription: e.shortDescription,
    instructions: e.instructions,
    steps: e.steps,
    formCues: e.formCues,
    commonMistakes: e.commonMistakes,
    breathing: e.breathing,
    videos: e.videos,
    thumbnails: e.thumbnails,
  }));

  // createMany in one batch is fine for ~240 rows; chunk anyway for safety
  const CHUNK = 100;
  let inserted = 0;
  for (let i = 0; i < data.length; i += CHUNK) {
    const chunk = data.slice(i, i + CHUNK);
    const res = await prisma.exercises.createMany({ data: chunk });
    inserted += res.count;
    console.log(`   … inserted ${inserted}/${data.length}`);
  }

  const after = await prisma.exercises.count();
  console.log(`\n🎉  Reseed complete! ${before} → ${after} exercises.`);
}

main()
  .catch((e) => {
    console.error("❌  Reseed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
