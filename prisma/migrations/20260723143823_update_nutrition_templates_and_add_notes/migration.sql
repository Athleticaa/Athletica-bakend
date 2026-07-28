/*
  Warnings:

  - You are about to drop the column `nutrition_template_day_id` on the `nutrition_template_meals` table. All the data in the column will be lost.
  - You are about to drop the `nutrition_template_days` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `nutrition_template_id` to the `nutrition_template_meals` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "nutrition_template_days" DROP CONSTRAINT "nutrition_template_days_nutrition_template_id_fkey";

-- DropForeignKey
ALTER TABLE "nutrition_template_meals" DROP CONSTRAINT "nutrition_template_meals_nutrition_template_day_id_fkey";

-- AlterTable
ALTER TABLE "nutrition_logs" ADD COLUMN     "notes" TEXT;

-- AlterTable
ALTER TABLE "nutrition_template_meals" DROP COLUMN "nutrition_template_day_id",
ADD COLUMN     "nutrition_template_id" UUID NOT NULL;

-- AlterTable
ALTER TABLE "workout_logs" ADD COLUMN     "notes" TEXT;

-- DropTable
DROP TABLE "nutrition_template_days";

-- AddForeignKey
ALTER TABLE "nutrition_template_meals" ADD CONSTRAINT "nutrition_template_meals_nutrition_template_id_fkey" FOREIGN KEY ("nutrition_template_id") REFERENCES "nutrition_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
