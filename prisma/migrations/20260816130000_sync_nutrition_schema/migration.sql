-- Align nutrition and food catalog tables with current Prisma schema

-- AlterTable
ALTER TABLE "food_categories"
ADD COLUMN "name_en" VARCHAR,
ADD COLUMN "name_ar" VARCHAR;

UPDATE "food_categories"
SET "name_en" = "name"
WHERE "name_en" IS NULL;

UPDATE "food_categories"
SET "name_ar" = "name"
WHERE "name_ar" IS NULL;

ALTER TABLE "food_categories"
ALTER COLUMN "name_en" SET NOT NULL,
ALTER COLUMN "name_ar" SET NOT NULL;

-- AlterTable
ALTER TABLE "foods"
ADD COLUMN "name_en" VARCHAR,
ADD COLUMN "name_ar" VARCHAR,
ADD COLUMN "serving_unit" VARCHAR,
ADD COLUMN "serving_unit_en" VARCHAR,
ADD COLUMN "serving_unit_ar" VARCHAR;

UPDATE "foods"
SET
  "name_en" = "name",
  "name_ar" = "name",
  "serving_unit" = COALESCE("serving_unit", 'g'),
  "serving_unit_en" = COALESCE("serving_unit_en", 'g'),
  "serving_unit_ar" = COALESCE("serving_unit_ar", 'غ')
WHERE "name_en" IS NULL
   OR "name_ar" IS NULL
   OR "serving_unit" IS NULL
   OR "serving_unit_en" IS NULL
   OR "serving_unit_ar" IS NULL;

ALTER TABLE "foods"
ALTER COLUMN "name_en" SET NOT NULL,
ALTER COLUMN "name_ar" SET NOT NULL,
ALTER COLUMN "serving_unit" SET NOT NULL,
ALTER COLUMN "serving_unit_en" SET NOT NULL,
ALTER COLUMN "serving_unit_ar" SET NOT NULL;

-- AlterTable
ALTER TABLE "nutrition_plans"
ADD COLUMN "nutrition_template_id" UUID;

-- Replace legacy daily logs table with meal-scoped logs table
DROP TABLE "nutrition_logs";

CREATE TABLE "nutrition_meal_logs" (
    "id" UUID NOT NULL,
    "nutrition_plan_id" UUID NOT NULL,
    "nutrition_meal_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nutrition_meal_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "nutrition_meals_nutrition_plan_id_meal_order_key" ON "nutrition_meals"("nutrition_plan_id", "meal_order");
CREATE UNIQUE INDEX "nutrition_meal_foods_nutrition_meal_id_food_id_key" ON "nutrition_meal_foods"("nutrition_meal_id", "food_id");
CREATE UNIQUE INDEX "nutrition_meal_logs_nutrition_meal_id_client_id_date_key" ON "nutrition_meal_logs"("nutrition_meal_id", "client_id", "date");
CREATE INDEX "nutrition_meal_logs_client_id_date_idx" ON "nutrition_meal_logs"("client_id", "date");
CREATE INDEX "nutrition_meal_logs_nutrition_plan_id_idx" ON "nutrition_meal_logs"("nutrition_plan_id");

-- AddForeignKey
ALTER TABLE "nutrition_plans" ADD CONSTRAINT "nutrition_plans_nutrition_template_id_fkey" FOREIGN KEY ("nutrition_template_id") REFERENCES "nutrition_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "nutrition_meal_logs" ADD CONSTRAINT "nutrition_meal_logs_nutrition_plan_id_fkey" FOREIGN KEY ("nutrition_plan_id") REFERENCES "nutrition_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "nutrition_meal_logs" ADD CONSTRAINT "nutrition_meal_logs_nutrition_meal_id_fkey" FOREIGN KEY ("nutrition_meal_id") REFERENCES "nutrition_meals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "nutrition_meal_logs" ADD CONSTRAINT "nutrition_meal_logs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "client_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
