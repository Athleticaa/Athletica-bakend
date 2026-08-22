import "dotenv/config";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Starting seed...\n");

  // 1. Client questions
  console.log("1. Seeding client questions...");
  const questionsPath = path.join(__dirname, "questions.json");
  const questions = JSON.parse(fs.readFileSync(questionsPath, "utf-8"));
  let questionCount = 0;
  for (const q of questions) {
    const groupKey = crypto.randomUUID();
    for (const lang of ["en", "ar"] as const) {
      await prisma.client_questions.upsert({
        where: { question_language: { question: q[lang], language: lang } },
        update: { choices: q.choices[lang], group_key: groupKey },
        create: { group_key: groupKey, question: q[lang], choices: q.choices[lang], language: lang },
      });
      questionCount++;
    }
  }
  console.log(`   Seeded ${questionCount} client questions (${questions.length} x 2)\n`);

  // 2. Exercises from JSON file
  console.log("2. Seeding exercises...");
  const exercisesPath = path.join(process.cwd(), "01_athletica_mvp_database_v2.json");
  const exercisesRaw = JSON.parse(fs.readFileSync(exercisesPath, "utf-8"));
  await prisma.exercises.createMany({
    data: exercisesRaw.map((e: any) => ({
      id: e.id, name_en: e.name_en, name_ar: e.name_ar, primary_muscle: e.primary_muscle,
      secondary_muscles: e.secondary_muscles, equipment: e.equipment, difficulty: e.difficulty,
      exercise_type: e.exercise_type, classification: e.classification, movement_pattern: e.movement_pattern,
      fitness_goals: e.fitness_goals, workout_location: e.workout_location, media_type: e.media_type,
      media_url: e.media_url, video_url: e.video_url, tags: e.tags, is_default: e.is_default, priority: e.priority,
    })),
    skipDuplicates: true,
  });
  console.log(`   Seeded ${exercisesRaw.length} exercises\n`);

  // 3. Food categories
  console.log("3. Seeding food categories...");
  const foodPath = path.join(process.cwd(), "prisma_seed_data-1 (1).json");
  const foodRaw = JSON.parse(fs.readFileSync(foodPath, "utf-8"));
  await prisma.food_categories.createMany({
    data: foodRaw.foodCategories.map((c: any) => ({
      id: c.id, name: c.name, name_en: c.name_en, name_ar: c.name_ar,
    })),
    skipDuplicates: true,
  });
  console.log(`   Seeded ${foodRaw.foodCategories.length} food categories\n`);

  // 4. Foods
  console.log("4. Seeding foods...");
  await prisma.foods.createMany({
    data: foodRaw.foods.map((f: any) => ({
      id: f.id, category_id: f.categoryId, name: f.name, name_en: f.name_en, name_ar: f.name_ar,
      base_grams: f.baseGrams, calories: f.calories, protein: f.protein, carbs: f.carbs, fat: f.fat,
      serving_unit: "g", serving_unit_en: "g", serving_unit_ar: "جرام",
    })),
    skipDuplicates: true,
  });
  console.log(`   Seeded ${foodRaw.foods.length} foods\n`);

  console.log("\nSeed completed!");
  console.log("Summary:");
  console.log(`  - ${questionCount} client questions`);
  console.log(`  - ${exercisesRaw.length} exercises`);
  console.log(`  - ${foodRaw.foodCategories.length} food categories`);
  console.log(`  - ${foodRaw.foods.length} foods`);
  console.log("  - Workout templates skipped (require existing coach_id)");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
