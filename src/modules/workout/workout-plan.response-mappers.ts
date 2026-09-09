export function toPlanResponse(plan: any) {
  const days = plan.workout_days?.map((day: any) => ({
    id: day.id,
    title: day.title,
    day_number: day.day_number,
    is_rest: day.is_rest,
    exercise_count: day.workout_day_exercises?.length ?? 0,
    exercises: day.workout_day_exercises?.map((ex: any) => ({
      id: ex.id,
      exercise_id: ex.exercise_id,
      order_number: ex.order_number,
      sets: ex.sets,
      reps: ex.reps,
      notes: ex.notes,
      exercise: ex.exercise ?? null,
    })) ?? [],
  })) ?? [];

  return {
    id: plan.id,
    coach_id: plan.coach_id,
    coach_client_id: plan.coach_client_id,
    title: plan.title,
    description: plan.description,
    start_date: plan.start_date,
    cycle_days: plan.cycle_days,
    is_active: plan.is_active,
    deleted_at: plan.deleted_at,
    day_count: plan.workout_days?.length ?? 0,
    days,
    created_at: plan.created_at,
  };
}

export function toPlanSummaryResponse(plan: any) {
  return {
    id: plan.id,
    title: plan.title,
    description: plan.description,
    is_active: plan.is_active,
    day_count: plan.workout_days?.length ?? 0,
    created_at: plan.created_at,
  };
}