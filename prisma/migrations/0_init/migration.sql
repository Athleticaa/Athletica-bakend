-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "client_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "gender" VARCHAR NOT NULL,
    "birth_date" DATE,
    "height" DOUBLE PRECISION,
    "weight" DOUBLE PRECISION,
    "goal" VARCHAR NOT NULL,

    CONSTRAINT "client_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coach_assignments" (
    "id" UUID NOT NULL,
    "coach_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coach_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coach_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "bio" TEXT NOT NULL,
    "specialization" VARCHAR NOT NULL,

    CONSTRAINT "coach_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coach_requests" (
    "id" UUID NOT NULL,
    "coach_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "status" VARCHAR NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coach_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exercises" (
    "id" UUID NOT NULL,
    "name" VARCHAR NOT NULL,
    "description" TEXT NOT NULL,
    "image" VARCHAR NOT NULL,
    "video" VARCHAR NOT NULL,
    "muscle" VARCHAR NOT NULL,

    CONSTRAINT "exercises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "foods" (
    "id" UUID NOT NULL,
    "name" VARCHAR NOT NULL,
    "calories" DOUBLE PRECISION NOT NULL,
    "protein" DOUBLE PRECISION NOT NULL,
    "carbs" DOUBLE PRECISION NOT NULL,
    "fat" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "foods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutrition_plan_days" (
    "id" UUID NOT NULL,
    "nutrition_plan_id" UUID NOT NULL,
    "day_number" INTEGER NOT NULL,
    "title" VARCHAR NOT NULL,

    CONSTRAINT "nutrition_plan_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutrition_plan_foods" (
    "id" UUID NOT NULL,
    "nutrition_plan_meal_id" UUID NOT NULL,
    "food_id" UUID NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "nutrition_plan_foods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutrition_plan_meals" (
    "id" UUID NOT NULL,
    "nutrition_plan_day_id" UUID NOT NULL,
    "meal_type" VARCHAR NOT NULL,
    "notes" TEXT NOT NULL,
    "meal_order" INTEGER NOT NULL,

    CONSTRAINT "nutrition_plan_meals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutrition_plans" (
    "id" UUID NOT NULL,
    "coach_assignment_id" UUID NOT NULL,
    "title" VARCHAR NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nutrition_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutrition_progress" (
    "id" UUID NOT NULL,
    "nutrition_plan_day_id" UUID NOT NULL,
    "completed" BOOLEAN NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "nutrition_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutrition_template_days" (
    "id" UUID NOT NULL,
    "nutrition_template_id" UUID NOT NULL,
    "day_number" INTEGER NOT NULL,
    "title" VARCHAR NOT NULL,

    CONSTRAINT "nutrition_template_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutrition_template_foods" (
    "id" UUID NOT NULL,
    "nutrition_template_meal_id" UUID NOT NULL,
    "food_id" UUID NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "nutrition_template_foods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutrition_template_meals" (
    "id" UUID NOT NULL,
    "nutrition_template_day_id" UUID NOT NULL,
    "meal_type" VARCHAR NOT NULL,
    "notes" TEXT NOT NULL,
    "meal_order" INTEGER NOT NULL,

    CONSTRAINT "nutrition_template_meals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutrition_templates" (
    "id" UUID NOT NULL,
    "coach_id" UUID NOT NULL,
    "title" VARCHAR NOT NULL,
    "description" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nutrition_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "first_name" VARCHAR NOT NULL,
    "last_name" VARCHAR NOT NULL,
    "email" VARCHAR NOT NULL,
    "password" VARCHAR NOT NULL,
    "role" VARCHAR NOT NULL,
    "provider" VARCHAR NOT NULL,
    "profile_image" VARCHAR,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_codes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" VARCHAR NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_plan_days" (
    "id" UUID NOT NULL,
    "workout_plan_id" UUID NOT NULL,
    "day_number" INTEGER NOT NULL,
    "title" VARCHAR NOT NULL,
    "is_rest" BOOLEAN NOT NULL,

    CONSTRAINT "workout_plan_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_plan_exercises" (
    "id" UUID NOT NULL,
    "workout_plan_day_id" UUID NOT NULL,
    "exercise_id" UUID NOT NULL,
    "exercise_order" INTEGER NOT NULL,
    "sets" INTEGER NOT NULL,
    "reps" INTEGER NOT NULL,
    "notes" TEXT NOT NULL,

    CONSTRAINT "workout_plan_exercises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_plans" (
    "id" UUID NOT NULL,
    "coach_assignment_id" UUID NOT NULL,
    "title" VARCHAR NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workout_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_progress" (
    "id" UUID NOT NULL,
    "workout_plan_day_id" UUID NOT NULL,
    "completed" BOOLEAN NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "workout_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_template_days" (
    "id" UUID NOT NULL,
    "workout_template_id" UUID NOT NULL,
    "day_number" INTEGER NOT NULL,
    "title" VARCHAR NOT NULL,
    "is_rest" BOOLEAN NOT NULL,

    CONSTRAINT "workout_template_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_template_exercises" (
    "id" UUID NOT NULL,
    "workout_template_day_id" UUID NOT NULL,
    "exercise_id" UUID NOT NULL,
    "exercise_order" INTEGER NOT NULL,
    "sets" INTEGER NOT NULL,
    "reps" INTEGER NOT NULL,
    "notes" TEXT NOT NULL,

    CONSTRAINT "workout_template_exercises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_templates" (
    "id" UUID NOT NULL,
    "coach_id" UUID NOT NULL,
    "title" VARCHAR NOT NULL,
    "description" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workout_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "coach_assignments_coach_id_client_id_key" ON "coach_assignments"("coach_id", "client_id");

-- CreateIndex
CREATE UNIQUE INDEX "coach_requests_coach_id_client_id_key" ON "coach_requests"("coach_id", "client_id");

-- CreateIndex
CREATE INDEX "password_reset_tokens_token_hash_idx" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_token_hash_idx" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "verification_codes_code_hash_idx" ON "verification_codes"("code_hash");

-- AddForeignKey
ALTER TABLE "client_profiles" ADD CONSTRAINT "client_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_assignments" ADD CONSTRAINT "coach_assignments_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "client_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_assignments" ADD CONSTRAINT "coach_assignments_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "coach_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_profiles" ADD CONSTRAINT "coach_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_requests" ADD CONSTRAINT "coach_requests_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "client_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_requests" ADD CONSTRAINT "coach_requests_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "coach_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_plan_days" ADD CONSTRAINT "nutrition_plan_days_nutrition_plan_id_fkey" FOREIGN KEY ("nutrition_plan_id") REFERENCES "nutrition_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_plan_foods" ADD CONSTRAINT "nutrition_plan_foods_food_id_fkey" FOREIGN KEY ("food_id") REFERENCES "foods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_plan_foods" ADD CONSTRAINT "nutrition_plan_foods_nutrition_plan_meal_id_fkey" FOREIGN KEY ("nutrition_plan_meal_id") REFERENCES "nutrition_plan_meals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_plan_meals" ADD CONSTRAINT "nutrition_plan_meals_nutrition_plan_day_id_fkey" FOREIGN KEY ("nutrition_plan_day_id") REFERENCES "nutrition_plan_days"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_plans" ADD CONSTRAINT "nutrition_plans_coach_assignment_id_fkey" FOREIGN KEY ("coach_assignment_id") REFERENCES "coach_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_progress" ADD CONSTRAINT "nutrition_progress_nutrition_plan_day_id_fkey" FOREIGN KEY ("nutrition_plan_day_id") REFERENCES "nutrition_plan_days"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_template_days" ADD CONSTRAINT "nutrition_template_days_nutrition_template_id_fkey" FOREIGN KEY ("nutrition_template_id") REFERENCES "nutrition_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_template_foods" ADD CONSTRAINT "nutrition_template_foods_food_id_fkey" FOREIGN KEY ("food_id") REFERENCES "foods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_template_foods" ADD CONSTRAINT "nutrition_template_foods_nutrition_template_meal_id_fkey" FOREIGN KEY ("nutrition_template_meal_id") REFERENCES "nutrition_template_meals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_template_meals" ADD CONSTRAINT "nutrition_template_meals_nutrition_template_day_id_fkey" FOREIGN KEY ("nutrition_template_day_id") REFERENCES "nutrition_template_days"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_templates" ADD CONSTRAINT "nutrition_templates_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "coach_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_codes" ADD CONSTRAINT "verification_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_plan_days" ADD CONSTRAINT "workout_plan_days_workout_plan_id_fkey" FOREIGN KEY ("workout_plan_id") REFERENCES "workout_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_plan_exercises" ADD CONSTRAINT "workout_plan_exercises_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_plan_exercises" ADD CONSTRAINT "workout_plan_exercises_workout_plan_day_id_fkey" FOREIGN KEY ("workout_plan_day_id") REFERENCES "workout_plan_days"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_plans" ADD CONSTRAINT "workout_plans_coach_assignment_id_fkey" FOREIGN KEY ("coach_assignment_id") REFERENCES "coach_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_progress" ADD CONSTRAINT "workout_progress_workout_plan_day_id_fkey" FOREIGN KEY ("workout_plan_day_id") REFERENCES "workout_plan_days"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_template_days" ADD CONSTRAINT "workout_template_days_workout_template_id_fkey" FOREIGN KEY ("workout_template_id") REFERENCES "workout_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_template_exercises" ADD CONSTRAINT "workout_template_exercises_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_template_exercises" ADD CONSTRAINT "workout_template_exercises_workout_template_day_id_fkey" FOREIGN KEY ("workout_template_day_id") REFERENCES "workout_template_days"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_templates" ADD CONSTRAINT "workout_templates_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "coach_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
