/**
 * reset-db.ts
 *
 * Clears all user/coach/client data from the database while
 * PRESERVING the following seed tables:
 *   - foods
 *   - food_categories
 *   - exercises
 *   - client_questions
 *
 * Run with:  npx tsx scripts/reset-db.ts
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("🗑️  Starting DB reset (preserving foods, exercises, client_questions)...\n");

  await prisma.$transaction([
    // ── Leaf tables first (no children) ──────────────────────────────────────

    // client_answers references client_profiles & client_questions
    prisma.client_answers.deleteMany(),

    // nutrition_meal_logs references nutrition_plans, nutrition_meals, client_profiles
    prisma.nutrition_meal_logs.deleteMany(),

    // workout_logs references workout_plans, workout_days, client_profiles
    prisma.workout_logs.deleteMany(),

    // nutrition_meal_foods references nutrition_meals & foods (keep foods)
    prisma.nutrition_meal_foods.deleteMany(),

    // nutrition_template_foods references nutrition_template_meals & foods (keep foods)
    prisma.nutrition_template_foods.deleteMany(),

    // workout_day_exercises references workout_days & exercises (keep exercises)
    prisma.workout_day_exercises.deleteMany(),

    // workout_template_exercises references workout_template_days & exercises (keep exercises)
    prisma.workout_template_exercises.deleteMany(),
  ]);

  console.log("✅  Cleared leaf tables");

  await prisma.$transaction([
    // ── Mid-level tables ──────────────────────────────────────────────────────

    prisma.nutrition_meals.deleteMany(),
    prisma.nutrition_template_meals.deleteMany(),
    prisma.workout_days.deleteMany(),
    prisma.workout_template_days.deleteMany(),
  ]);

  console.log("✅  Cleared meal/day tables");

  await prisma.$transaction([
    // ── Plan / template tables ────────────────────────────────────────────────

    prisma.nutrition_plans.deleteMany(),
    prisma.nutrition_templates.deleteMany(),
    prisma.workout_plans.deleteMany(),
    prisma.workout_templates.deleteMany(),
  ]);

  console.log("✅  Cleared plan/template tables");

  await prisma.$transaction([
    // ── Coach-client relationship tables ─────────────────────────────────────

    prisma.coach_clients.deleteMany(),
    prisma.coach_requests.deleteMany(),
  ]);

  console.log("✅  Cleared coach-client relationship tables");

  await prisma.$transaction([
    // ── Profile tables ────────────────────────────────────────────────────────

    prisma.client_profiles.deleteMany(),
    prisma.coach_profiles.deleteMany(),
  ]);

  console.log("✅  Cleared profile tables");

  await prisma.$transaction([
    // ── User & auth tables ────────────────────────────────────────────────────

    prisma.refresh_tokens.deleteMany(),
    prisma.password_reset_tokens.deleteMany(),
    prisma.verification_codes.deleteMany(),
    prisma.users.deleteMany(),
  ]);

  console.log("✅  Cleared user & auth tables");

  console.log("\n🎉  DB reset complete!");
  console.log("   Preserved: foods, food_categories, exercises, client_questions");
}

main()
  .catch((e) => {
    console.error("❌  Reset failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
