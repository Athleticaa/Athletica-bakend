import { PrismaClient } from "@prisma/client";
import { inject } from "tsyringe";
import { PrismaClientToken } from "../../di/tokens";
import { ServiceError } from "../../lib/service-error";

export abstract class WorkoutBaseService {
  constructor(@inject(PrismaClientToken) protected prisma: PrismaClient) {}

  protected async getCoachProfileId(userId: string): Promise<string> {
    const profile = await this.prisma.coach_profiles.findFirst({ where: { user_id: userId } });
    if (!profile) throw new ServiceError("coach_profile_not_found", 404);
    return profile.id;
  }

  protected async getCoachClientId(coachId: string, coachClientId: string) {
    const cc = await this.prisma.coach_clients.findFirst({
      where: { id: coachClientId, coach_id: coachId },
    });
    if (!cc) throw new ServiceError("client_not_assigned_to_coach", 404);
    return cc;
  }

  protected async getOwnedTemplate(coachId: string, id: string) {
    const template = await this.prisma.workout_templates.findFirst({
      where: { id, coach_id: coachId, deleted_at: null },
      include: {
        workout_template_days: {
          orderBy: { day_number: "asc" },
          include: {
            workout_template_exercises: { orderBy: { exercise_order: "asc" } },
          },
        },
      },
    });
    if (!template) throw new ServiceError("template_not_found", 404);
    return template;
  }

  protected async getOwnedTemplateSummary(coachId: string, id: string) {
    const template = await this.prisma.workout_templates.findFirst({
      where: { id, coach_id: coachId, deleted_at: null },
      include: { _count: { select: { workout_template_days: true } } },
    });
    if (!template) throw new ServiceError("template_not_found", 404);
    return template;
  }

  protected async getOwnedPlan(coachId: string, planId: string) {
    const plan = await this.prisma.workout_plans.findFirst({
      where: { id: planId, coach_id: coachId, deleted_at: null },
      include: {
        workout_days: {
          orderBy: { day_number: "asc" },
          include: {
            workout_day_exercises: { orderBy: { order_number: "asc" } },
          },
        },
      },
    });
    if (!plan) throw new ServiceError("plan_not_found", 404);
    return plan;
  }

  protected async getOwnedPlanSummary(coachId: string, planId: string) {
    const plan = await this.prisma.workout_plans.findFirst({
      where: { id: planId, coach_id: coachId, deleted_at: null },
      include: { _count: { select: { workout_days: true } } },
    });
    if (!plan) throw new ServiceError("plan_not_found", 404);
    return plan;
  }

  protected async getOwnedTemplateDay(templateId: string, dayId: string) {
    const day = await this.prisma.workout_template_days.findFirst({
      where: { id: dayId, workout_template_id: templateId },
    });
    if (!day) throw new ServiceError("day_not_found", 404);
    return day;
  }

  protected async getOwnedPlanDay(planId: string, dayId: string) {
    const day = await this.prisma.workout_days.findFirst({
      where: { id: dayId, workout_plan_id: planId },
    });
    if (!day) throw new ServiceError("workout_day_not_found", 404);
    return day;
  }

  protected async getTemplateExercise(dayId: string, exerciseId: string) {
    const exercise = await this.prisma.workout_template_exercises.findFirst({
      where: { id: exerciseId, workout_template_day_id: dayId },
    });
    if (!exercise) throw new ServiceError("exercise_not_found", 404);
    return exercise;
  }

  protected async getPlanExercise(dayId: string, exerciseId: string) {
    const exercise = await this.prisma.workout_day_exercises.findFirst({
      where: { id: exerciseId, workout_day_id: dayId },
    });
    if (!exercise) throw new ServiceError("exercise_not_found", 404);
    return exercise;
  }

  protected async validateExerciseExists(exerciseId: string) {
    const exercise = await this.prisma.exercises.findUnique({ where: { id: exerciseId } });
    if (!exercise) throw new ServiceError("exercise_not_found", 404);
    return exercise;
  }
}
