export function toTemplateResponse(template: any) {
  const days = template.workout_template_days?.map((day: any) => ({
    id: day.id,
    title: day.title,
    day_number: day.day_number,
    is_rest: day.is_rest,
    exercise_count: day.workout_template_exercises?.length ?? 0,
    exercises: day.workout_template_exercises?.map((ex: any) => ({
      id: ex.id,
      exercise_id: ex.exercise_id,
      exercise_order: ex.exercise_order,
      sets: ex.sets,
      reps: ex.reps,
      notes: ex.notes,
      exercise: ex.exercise ?? null,
    })) ?? [],
  })) ?? [];

  return {
    id: template.id,
    title: template.title,
    description: template.description,
    coach_id: template.coach_id,
    deleted_at: template.deleted_at,
    day_count: template.workout_template_days?.length ?? 0,
    days,
    created_at: template.created_at,
  };
}

export function toTemplateSummaryResponse(template: any) {
  return {
    id: template.id,
    title: template.title,
    description: template.description,
    coach_id: template.coach_id,
    day_count: template.workout_template_days?.length ?? 0,
    created_at: template.created_at,
  };
}