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
 * Also de-duplicates `foods` (repetition foods) after clearing FK dependencies.
 * De-duplication key: LOWER(TRIM(name_ar)) globally – Arabic name is the most
 * reliable human key (covers 10 dup groups like Banana/Bananas, Apple/Apples,
 * Avocado/Avocados, Shrimp/Prawns, etc.). Cross-category repeats (e.g.
 * Buckwheat twice in Carbs+Snack) are also collapsed.
 * For each duplicate group we keep the earliest `created_at` / smallest `id`
 * and delete the rest. FK tables are already emptied at that point, so no
 * re-point is needed. If FKs still exist (future use without full reset),
 * the helper also safely re-points nutrition_*_foods.
 *
 * Run with:  npx tsx scripts/reset-db.ts [--dry-run]
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function dedupeFoods() {
  // Show what will be deduped (dry inspection)
  const dupGroups: Array<{ key_ar: string; cnt: number }> = await prisma.$queryRawUnsafe(`
    SELECT LOWER(TRIM(name_ar)) as key_ar, COUNT(*)::int as cnt
    FROM foods
    GROUP BY LOWER(TRIM(name_ar))
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC
  `);

  if (dupGroups.length === 0) {
    console.log("✅  No duplicate foods found (by name_ar).");
    // Also check global English fallback (if Arabic differs but English duplicates)
    const enDups: Array<{ key_en: string; cnt: number }> = await prisma.$queryRawUnsafe(`
      SELECT LOWER(TRIM(name_en)) as key_en, COUNT(*)::int as cnt
      FROM foods GROUP BY LOWER(TRIM(name_en)) HAVING COUNT(*) > 1
    `);
    if (enDups.length === 0) {
      console.log("✅  No duplicate foods found (by name_en) either.");
      return 0;
    }
    console.log(`⚠️  Found ${enDups.length} English duplicate groups (Arabic was clean):`, enDups);
  } else {
    console.log(`🔍  Found ${dupGroups.length} duplicate groups by name_ar (total extra rows = ${dupGroups.reduce((s, g) => s + (g.cnt - 1), 0)}):`);
    for (const g of dupGroups.slice(0, 10)) {
      console.log(`   - "${g.key_ar}" ×${g.cnt}`);
    }
    if (dupGroups.length > 10) console.log(`   ... +${dupGroups.length - 10} more`);
  }

  // If --dry-run, stop here
  if (process.argv.includes("--dry-run")) {
    console.log("💡  Dry-run mode – skipping actual deletion.");
    return 0;
  }

  // Detect whether FK tables still have rows – if so, re-point before delete
  const templateFoodCount = await prisma.nutrition_template_foods.count();
  const mealFoodCount = await prisma.nutrition_meal_foods.count();
  const needsRepoint = templateFoodCount > 0 || mealFoodCount > 0;
  if (needsRepoint) {
    console.log(`⚠️  FK tables not empty (template_foods=${templateFoodCount}, meal_foods=${mealFoodCount}) – will re-point duplicates before delete.`);
  }

  // We handle dupes in application loop to safely re-point FKs and avoid
  // unique-violation on (meal_id, food_id). Doing it in SQL loop is safer
  // than a single raw DELETE when FKs still exist.
  // Approach: for each duplicate Arabic key, pick keep_id, then for each dup_id:
  //   1) try to re-point referencing rows to keep_id
  //   2) if conflict (unique), delete the conflicting dup row
  //   3) delete the food row itself
  const groupsDetail: Array<{ key_ar: string; ids: string }> = await prisma.$queryRawUnsafe(`
    SELECT LOWER(TRIM(name_ar)) as key_ar, string_agg(id::text, ',' ORDER BY created_at ASC, id ASC) as ids
    FROM foods
    GROUP BY LOWER(TRIM(name_ar))
    HAVING COUNT(*) > 1
  `);

  let deleted = 0;
  for (const g of groupsDetail) {
    const ids = g.ids.split(",");
    const keepId = ids[0];
    const dupIds = ids.slice(1);
    for (const dupId of dupIds) {
      if (needsRepoint) {
        // Re-point template foods – handle unique conflict by deleting duplicate mapping
        // We do raw SQL with ON CONFLICT handling: delete rows that would violate unique, then update rest
        await prisma.$executeRawUnsafe(`
          DELETE FROM nutrition_template_foods
          WHERE food_id = $1::uuid
            AND nutrition_template_meal_id IN (
              SELECT nutrition_template_meal_id FROM nutrition_template_foods WHERE food_id = $2::uuid
            )
        `, dupId, keepId);
        await prisma.$executeRawUnsafe(`
          UPDATE nutrition_template_foods SET food_id = $2::uuid WHERE food_id = $1::uuid
        `, dupId, keepId);

        await prisma.$executeRawUnsafe(`
          DELETE FROM nutrition_meal_foods
          WHERE food_id = $1::uuid
            AND nutrition_meal_id IN (
              SELECT nutrition_meal_id FROM nutrition_meal_foods WHERE food_id = $2::uuid
            )
        `, dupId, keepId);
        await prisma.$executeRawUnsafe(`
          UPDATE nutrition_meal_foods SET food_id = $2::uuid WHERE food_id = $1::uuid
        `, dupId, keepId);
      }
      await prisma.$executeRawUnsafe(`DELETE FROM foods WHERE id = $1::uuid`, dupId);
      deleted++;
    }
  }

  // Second pass: English duplicates where Arabic differed (fallback) – same logic
  const enGroups: Array<{ key_en: string; ids: string }> = await prisma.$queryRawUnsafe(`
    SELECT LOWER(TRIM(name_en)) as key_en, string_agg(id::text, ',' ORDER BY created_at ASC, id ASC) as ids
    FROM foods
    GROUP BY LOWER(TRIM(name_en))
    HAVING COUNT(*) > 1
  `);
  for (const g of enGroups) {
    const ids = g.ids.split(",");
    if (ids.length <= 1) continue;
    // If this group was already handled via Arabic dedup, skip (keepId already same)
    // We re-check if those ids still exist
    const existing: Array<{ id: string }> = await prisma.$queryRawUnsafe(
      `SELECT id::text as id FROM foods WHERE id IN (${ids.map((_, i) => `$${i + 1}::uuid`).join(",")})`,
      ...ids
    );
    if (existing.length <= 1) continue;
    const keepId = existing.sort((a, b) => a.id.localeCompare(b.id))[0].id;
    const dupIds = existing.filter(r => r.id !== keepId).map(r => r.id);
    for (const dupId of dupIds) {
      if (needsRepoint) {
        await prisma.$executeRawUnsafe(`
          DELETE FROM nutrition_template_foods
          WHERE food_id = $1::uuid
            AND nutrition_template_meal_id IN (
              SELECT nutrition_template_meal_id FROM nutrition_template_foods WHERE food_id = $2::uuid
            )
        `, dupId, keepId);
        await prisma.$executeRawUnsafe(`UPDATE nutrition_template_foods SET food_id = $2::uuid WHERE food_id = $1::uuid`, dupId, keepId);
        await prisma.$executeRawUnsafe(`
          DELETE FROM nutrition_meal_foods
          WHERE food_id = $1::uuid
            AND nutrition_meal_id IN (
              SELECT nutrition_meal_id FROM nutrition_meal_foods WHERE food_id = $2::uuid
            )
        `, dupId, keepId);
        await prisma.$executeRawUnsafe(`UPDATE nutrition_meal_foods SET food_id = $2::uuid WHERE food_id = $1::uuid`, dupId, keepId);
      }
      await prisma.$executeRawUnsafe(`DELETE FROM foods WHERE id = $1::uuid`, dupId);
      deleted++;
    }
  }

  console.log(`🧹  Deduplicated ${deleted} foods (kept earliest per name_ar / name_en).`);
  return deleted;
}

async function main() {
  const isDryRun = process.argv.includes("--dry-run");
  if (isDryRun) console.log("🔎  Dry-run mode enabled – no data will be deleted.\n");
  console.log("🗑️  Starting DB reset (preserving foods, food_categories, exercises, client_questions)...\n");

  const before = {
    foods: await prisma.foods.count(),
    food_categories: await prisma.food_categories.count(),
    exercises: await prisma.exercises.count(),
    client_questions: await prisma.client_questions.count(),
    users: await prisma.users.count(),
  };
  console.log("📊  Before:", before);

  if (isDryRun) {
    console.log("\n🔎  Dry-run: inspecting duplicates without deleting...\n");
    await dedupeFoods();
    const afterDry = {
      foods: await prisma.foods.count(),
      food_categories: await prisma.food_categories.count(),
      exercises: await prisma.exercises.count(),
      client_questions: await prisma.client_questions.count(),
    };
    console.log("\n📊  After (dry-run, unchanged):", afterDry);
    console.log("💡  Dry-run complete – no deletions executed.");
    return;
  }

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

  // ── Deduplicate foods while FK targets are already empty (no re-point needed in reset case) ──
  const deduped = await dedupeFoods();


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

  const after = {
    foods: await prisma.foods.count(),
    food_categories: await prisma.food_categories.count(),
    exercises: await prisma.exercises.count(),
    client_questions: await prisma.client_questions.count(),
    users: await prisma.users.count(),
  };
  console.log("\n🎉  DB reset complete!");
  console.log("   Preserved: foods, food_categories, exercises, client_questions");
  console.log("📊  Before:", before);
  console.log("📊  After :", after);
  console.log(`🧹  Foods deduplicated: ${deduped}`);
  if (after.foods < before.foods) {
    console.log(`   Foods reduced: ${before.foods} → ${after.foods} (removed ${before.foods - after.foods})`);
  }
}

main()
  .catch((e) => {
    console.error("❌  Reset failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
