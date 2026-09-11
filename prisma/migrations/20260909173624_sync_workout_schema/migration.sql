-- Sync database with current schema.prisma (workout + nutrition)
-- Generated via `prisma migrate diff --from-config-datasource --to-schema` after reset

-- AlterTable
ALTER TABLE "coach_requests" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "nutrition_plans" DROP COLUMN "end_date",
DROP COLUMN "start_date",
ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "nutrition_templates" ADD COLUMN     "is_deleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "workout_day_exercises" ALTER COLUMN "sets" DROP NOT NULL,
ALTER COLUMN "reps" DROP NOT NULL;

-- AlterTable
ALTER TABLE "workout_plans" ADD COLUMN     "coach_id" UUID NOT NULL,
ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "workout_template_id" UUID;

-- AlterTable
ALTER TABLE "workout_template_exercises" ALTER COLUMN "sets" DROP NOT NULL,
ALTER COLUMN "reps" DROP NOT NULL;

-- AlterTable
ALTER TABLE "workout_templates" ADD COLUMN     "deleted_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "nutrition_meal_foods_nutrition_meal_id_idx" ON "nutrition_meal_foods"("nutrition_meal_id");

-- CreateIndex
CREATE INDEX "nutrition_meals_nutrition_plan_id_idx" ON "nutrition_meals"("nutrition_plan_id");

-- CreateIndex
CREATE INDEX "nutrition_plans_coach_client_id_idx" ON "nutrition_plans"("coach_client_id");

-- CreateIndex
CREATE INDEX "nutrition_template_foods_nutrition_template_meal_id_idx" ON "nutrition_template_foods"("nutrition_template_meal_id");

-- CreateIndex
CREATE UNIQUE INDEX "nutrition_template_foods_nutrition_template_meal_id_food_id_key" ON "nutrition_template_foods"("nutrition_template_meal_id", "food_id");

-- CreateIndex
CREATE INDEX "nutrition_template_meals_nutrition_template_id_idx" ON "nutrition_template_meals"("nutrition_template_id");

-- CreateIndex
CREATE UNIQUE INDEX "nutrition_template_meals_nutrition_template_id_meal_order_key" ON "nutrition_template_meals"("nutrition_template_id", "meal_order");

-- CreateIndex
CREATE UNIQUE INDEX "workout_day_exercises_workout_day_id_order_number_key" ON "workout_day_exercises"("workout_day_id", "order_number");

-- CreateIndex
CREATE UNIQUE INDEX "workout_template_exercises_workout_template_day_id_exercise_key" ON "workout_template_exercises"("workout_template_day_id", "exercise_order");

-- AddForeignKey
ALTER TABLE "workout_plans" ADD CONSTRAINT "workout_plans_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "coach_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_plans" ADD CONSTRAINT "workout_plans_workout_template_id_fkey" FOREIGN KEY ("workout_template_id") REFERENCES "workout_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
