-- Per-exercise workout completion logs (mirrors nutrition_meal_logs)
-- One row per plan exercise per client per date; day is complete when all logs are completed

-- CreateTable
CREATE TABLE "workout_exercise_logs" (
    "id" UUID NOT NULL,
    "workout_plan_id" UUID NOT NULL,
    "workout_day_id" UUID NOT NULL,
    "workout_day_exercise_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "workout_date" DATE NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workout_exercise_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workout_exercise_logs_workout_day_exercise_id_client_id_workout_date_key" ON "workout_exercise_logs"("workout_day_exercise_id", "client_id", "workout_date");
CREATE INDEX "workout_exercise_logs_client_id_workout_date_idx" ON "workout_exercise_logs"("client_id", "workout_date");
CREATE INDEX "workout_exercise_logs_workout_plan_id_idx" ON "workout_exercise_logs"("workout_plan_id");

-- AddForeignKey
ALTER TABLE "workout_exercise_logs" ADD CONSTRAINT "workout_exercise_logs_workout_plan_id_fkey" FOREIGN KEY ("workout_plan_id") REFERENCES "workout_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workout_exercise_logs" ADD CONSTRAINT "workout_exercise_logs_workout_day_id_fkey" FOREIGN KEY ("workout_day_id") REFERENCES "workout_days"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workout_exercise_logs" ADD CONSTRAINT "workout_exercise_logs_workout_day_exercise_id_fkey" FOREIGN KEY ("workout_day_exercise_id") REFERENCES "workout_day_exercises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workout_exercise_logs" ADD CONSTRAINT "workout_exercise_logs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "client_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
