-- Drop the meal_type CHECK constraint so any string value is accepted
ALTER TABLE "nutrition_meals" DROP CONSTRAINT IF EXISTS "chk_nutrition_meals_meal_type";
ALTER TABLE "nutrition_template_meals" DROP CONSTRAINT IF EXISTS "chk_nutrition_template_meals_meal_type";
