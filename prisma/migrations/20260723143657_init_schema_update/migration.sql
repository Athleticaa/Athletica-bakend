/*
  Warnings:

  - You are about to drop the column `coach_assignment_id` on the `nutrition_plans` table. All the data in the column will be lost.
  - You are about to drop the column `coach_assignment_id` on the `workout_plans` table. All the data in the column will be lost.
  - You are about to drop the column `end_date` on the `workout_plans` table. All the data in the column will be lost.
  - You are about to drop the `coach_assignments` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `nutrition_plan_days` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `nutrition_plan_foods` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `nutrition_plan_meals` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `nutrition_progress` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `workout_plan_days` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `workout_plan_exercises` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `workout_progress` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `coach_client_id` to the `nutrition_plans` table without a default value. This is not possible if the table is not empty.
  - Added the required column `description` to the `nutrition_plans` table without a default value. This is not possible if the table is not empty.
  - Added the required column `coach_client_id` to the `workout_plans` table without a default value. This is not possible if the table is not empty.
  - Added the required column `cycle_days` to the `workout_plans` table without a default value. This is not possible if the table is not empty.
  - Added the required column `description` to the `workout_plans` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "coach_assignments" DROP CONSTRAINT "coach_assignments_client_id_fkey";

-- DropForeignKey
ALTER TABLE "coach_assignments" DROP CONSTRAINT "coach_assignments_coach_id_fkey";

-- DropForeignKey
ALTER TABLE "nutrition_plan_days" DROP CONSTRAINT "nutrition_plan_days_nutrition_plan_id_fkey";

-- DropForeignKey
ALTER TABLE "nutrition_plan_foods" DROP CONSTRAINT "nutrition_plan_foods_food_id_fkey";

-- DropForeignKey
ALTER TABLE "nutrition_plan_foods" DROP CONSTRAINT "nutrition_plan_foods_nutrition_plan_meal_id_fkey";

-- DropForeignKey
ALTER TABLE "nutrition_plan_meals" DROP CONSTRAINT "nutrition_plan_meals_nutrition_plan_day_id_fkey";

-- DropForeignKey
ALTER TABLE "nutrition_plans" DROP CONSTRAINT "nutrition_plans_coach_assignment_id_fkey";

-- DropForeignKey
ALTER TABLE "nutrition_progress" DROP CONSTRAINT "nutrition_progress_nutrition_plan_day_id_fkey";

-- DropForeignKey
ALTER TABLE "workout_plan_days" DROP CONSTRAINT "workout_plan_days_workout_plan_id_fkey";

-- DropForeignKey
ALTER TABLE "workout_plan_exercises" DROP CONSTRAINT "workout_plan_exercises_exercise_id_fkey";

-- DropForeignKey
ALTER TABLE "workout_plan_exercises" DROP CONSTRAINT "workout_plan_exercises_workout_plan_day_id_fkey";

-- DropForeignKey
ALTER TABLE "workout_plans" DROP CONSTRAINT "workout_plans_coach_assignment_id_fkey";

-- DropForeignKey
ALTER TABLE "workout_progress" DROP CONSTRAINT "workout_progress_workout_plan_day_id_fkey";

-- AlterTable
ALTER TABLE "nutrition_plans" DROP COLUMN "coach_assignment_id",
ADD COLUMN     "coach_client_id" UUID NOT NULL,
ADD COLUMN     "description" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "workout_plans" DROP COLUMN "coach_assignment_id",
DROP COLUMN "end_date",
ADD COLUMN     "coach_client_id" UUID NOT NULL,
ADD COLUMN     "cycle_days" INTEGER NOT NULL,
ADD COLUMN     "description" TEXT NOT NULL;

-- DropTable
DROP TABLE "coach_assignments";

-- DropTable
DROP TABLE "nutrition_plan_days";

-- DropTable
DROP TABLE "nutrition_plan_foods";

-- DropTable
DROP TABLE "nutrition_plan_meals";

-- DropTable
DROP TABLE "nutrition_progress";

-- DropTable
DROP TABLE "workout_plan_days";

-- DropTable
DROP TABLE "workout_plan_exercises";

-- DropTable
DROP TABLE "workout_progress";

-- CreateTable
CREATE TABLE "coach_clients" (
    "id" UUID NOT NULL,
    "coach_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coach_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_days" (
    "id" UUID NOT NULL,
    "workout_plan_id" UUID NOT NULL,
    "day_number" INTEGER NOT NULL,
    "title" VARCHAR NOT NULL,
    "is_rest" BOOLEAN NOT NULL,

    CONSTRAINT "workout_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_day_exercises" (
    "id" UUID NOT NULL,
    "workout_day_id" UUID NOT NULL,
    "exercise_id" UUID NOT NULL,
    "order_number" INTEGER NOT NULL,
    "sets" INTEGER NOT NULL,
    "reps" INTEGER NOT NULL,
    "notes" TEXT NOT NULL,

    CONSTRAINT "workout_day_exercises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_logs" (
    "id" UUID NOT NULL,
    "workout_plan_id" UUID NOT NULL,
    "workout_day_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "workout_date" DATE NOT NULL,
    "completed" BOOLEAN NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "workout_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutrition_meals" (
    "id" UUID NOT NULL,
    "nutrition_plan_id" UUID NOT NULL,
    "meal_type" VARCHAR NOT NULL,
    "notes" TEXT NOT NULL,
    "meal_order" INTEGER NOT NULL,

    CONSTRAINT "nutrition_meals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutrition_meal_foods" (
    "id" UUID NOT NULL,
    "nutrition_meal_id" UUID NOT NULL,
    "food_id" UUID NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "nutrition_meal_foods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutrition_logs" (
    "id" UUID NOT NULL,
    "nutrition_plan_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "completed" BOOLEAN NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "nutrition_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "coach_clients_coach_id_client_id_key" ON "coach_clients"("coach_id", "client_id");

-- AddForeignKey
ALTER TABLE "coach_clients" ADD CONSTRAINT "coach_clients_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "coach_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_clients" ADD CONSTRAINT "coach_clients_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "client_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_plans" ADD CONSTRAINT "workout_plans_coach_client_id_fkey" FOREIGN KEY ("coach_client_id") REFERENCES "coach_clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_days" ADD CONSTRAINT "workout_days_workout_plan_id_fkey" FOREIGN KEY ("workout_plan_id") REFERENCES "workout_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_day_exercises" ADD CONSTRAINT "workout_day_exercises_workout_day_id_fkey" FOREIGN KEY ("workout_day_id") REFERENCES "workout_days"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_day_exercises" ADD CONSTRAINT "workout_day_exercises_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_logs" ADD CONSTRAINT "workout_logs_workout_plan_id_fkey" FOREIGN KEY ("workout_plan_id") REFERENCES "workout_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_logs" ADD CONSTRAINT "workout_logs_workout_day_id_fkey" FOREIGN KEY ("workout_day_id") REFERENCES "workout_days"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_logs" ADD CONSTRAINT "workout_logs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "client_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_plans" ADD CONSTRAINT "nutrition_plans_coach_client_id_fkey" FOREIGN KEY ("coach_client_id") REFERENCES "coach_clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_meals" ADD CONSTRAINT "nutrition_meals_nutrition_plan_id_fkey" FOREIGN KEY ("nutrition_plan_id") REFERENCES "nutrition_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_meal_foods" ADD CONSTRAINT "nutrition_meal_foods_nutrition_meal_id_fkey" FOREIGN KEY ("nutrition_meal_id") REFERENCES "nutrition_meals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_meal_foods" ADD CONSTRAINT "nutrition_meal_foods_food_id_fkey" FOREIGN KEY ("food_id") REFERENCES "foods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_logs" ADD CONSTRAINT "nutrition_logs_nutrition_plan_id_fkey" FOREIGN KEY ("nutrition_plan_id") REFERENCES "nutrition_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_logs" ADD CONSTRAINT "nutrition_logs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "client_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
