import { injectable, inject } from "tsyringe";
import { PrismaClientToken } from "../../di/tokens";
import { PrismaClient } from "@prisma/client";
import { ServiceError } from "../../lib/service-error";
import { WorkoutBaseService } from "./workout.base.service";
import { todayDateOnly, daysBetween } from "../nutrition/nutrition.utils";

@injectable()
export class WorkoutClientService extends WorkoutBaseService {
  constructor(@inject(PrismaClientToken) prisma: PrismaClient) {
    super(prisma);
  }

  private async getClientProfileId(userId: string): Promise<string> {
    const profile = await this.prisma.client_profiles.findFirst({ where: { user_id: userId } });
    if (!profile) throw new ServiceError("client_profile_not_found", 404);
    return profile.id;
  }

  async getTodayWorkout(userId: string) {
    const clientId = await this.getClientProfileId(userId);

    const plan = await this.prisma.workout_plans.findFirst({
      where: { coach_client_id: clientId, is_active: true, deleted_at: null },
      include: {
        workout_days: {
          orderBy: { day_number: "asc" },
          include: {
            workout_day_exercises: {
              orderBy: { order_number: "asc" },
              include: { exercise: true },
            },
          },
        },
      },
    });

    if (!plan) {
      return { workout: null };
    }

    const today = todayDateOnly();
    const startDate = new Date(plan.start_date);
    const daysSinceStart = daysBetween(startDate, today);

    if (daysSinceStart < 0) {
      return { workout: null };
    }

    const cyclePosition = daysSinceStart % plan.cycle_days;
    const dayNumber = cyclePosition + 1;

    const day = plan.workout_days.find((d: any) => d.day_number === dayNumber);
    if (!day) {
      throw new ServiceError("workout_day_not_found", 404);
    }

    let log = await this.prisma.workout_logs.findFirst({
      where: {
        client_id: clientId,
        workout_day_id: day.id,
        workout_plan_id: plan.id,
        workout_date: today,
      },
    });

    if (!log) {
      log = await this.prisma.workout_logs.create({
        data: {
          workout_plan_id: plan.id,
          workout_day_id: day.id,
          client_id: clientId,
          workout_date: today,
          completed: false,
        },
      });
    }

    return {
      workout: {
        day_id: day.id,
        title: day.title,
        day_number: day.day_number,
        is_rest: day.is_rest,
        exercises: day.workout_day_exercises.map((ex: any) => ({
          id: ex.id,
          exercise_id: ex.exercise_id,
          order_number: ex.order_number,
          sets: ex.sets,
          reps: ex.reps,
          notes: ex.notes,
          exercise: ex.exercise
            ? { id: ex.exercise.id, name: ex.exercise.name, muscle_group: ex.exercise.primary_muscle }
            : null,
        })),
        completed: log.completed,
        log_id: log.id,
      },
    };
  }

  async getMyActivePlan(userId: string) {
    const clientId = await this.getClientProfileId(userId);

    const plan = await this.prisma.workout_plans.findFirst({
      where: { coach_client_id: clientId, is_active: true, deleted_at: null },
      include: { _count: { select: { workout_days: true } } },
    });

    if (!plan) {
      return { plan: null };
    }

    return {
      plan: {
        id: plan.id,
        title: plan.title,
        description: plan.description,
        start_date: plan.start_date,
        cycle_days: plan.cycle_days,
        day_count: plan._count.workout_days,
      },
    };
  }

  async getPlanDetails(userId: string, planId: string) {
    const clientId = await this.getClientProfileId(userId);

    const plan = await this.prisma.workout_plans.findFirst({
      where: { id: planId, coach_client_id: clientId, deleted_at: null },
      include: {
        workout_days: {
          orderBy: { day_number: "asc" },
          include: {
            workout_day_exercises: {
              orderBy: { order_number: "asc" },
              include: { exercise: true },
            },
          },
        },
      },
    });

    if (!plan) {
      throw new ServiceError("plan_not_found", 404);
    }

    return {
      plan: {
        id: plan.id,
        title: plan.title,
        description: plan.description,
        start_date: plan.start_date,
        cycle_days: plan.cycle_days,
        is_active: plan.is_active,
        days: plan.workout_days.map((day: any) => ({
          id: day.id,
          title: day.title,
          day_number: day.day_number,
          is_rest: day.is_rest,
          exercises: day.workout_day_exercises.map((ex: any) => ({
            id: ex.id,
            exercise_id: ex.exercise_id,
            order_number: ex.order_number,
            sets: ex.sets,
            reps: ex.reps,
            notes: ex.notes,
            exercise: ex.exercise
              ? { id: ex.exercise.id, name: ex.exercise.name, muscle_group: ex.exercise.primary_muscle }
              : null,
          })),
        })),
      },
    };
  }

  async completeWorkout(userId: string, logId: string) {
    const clientId = await this.getClientProfileId(userId);

    const log = await this.prisma.workout_logs.findFirst({
      where: { id: logId, client_id: clientId },
    });

    if (!log) {
      throw new ServiceError("workout_log_not_found", 404);
    }

    const today = todayDateOnly();
    const logDate = new Date(log.workout_date);

    if (logDate.getTime() !== today.getTime()) {
      throw new ServiceError("workout_today_only", 400);
    }

    if (log.completed) {
      throw new ServiceError("workout_already_completed", 400);
    }

    const updated = await this.prisma.workout_logs.update({
      where: { id: logId },
      data: { completed: true },
    });

    const dayCompleted = await this.isDayCompleted(clientId, updated.workout_plan_id, updated.workout_day_id, updated.workout_date);

    return {
      workout_log: {
        id: updated.id,
        workout_date: updated.workout_date,
        completed: updated.completed,
      },
      day_completed: dayCompleted,
    };
  }

  async uncompleteWorkout(userId: string, logId: string) {
    const clientId = await this.getClientProfileId(userId);

    const log = await this.prisma.workout_logs.findFirst({
      where: { id: logId, client_id: clientId },
    });

    if (!log) {
      throw new ServiceError("workout_log_not_found", 404);
    }

    const today = todayDateOnly();
    const logDate = new Date(log.workout_date);

    if (logDate.getTime() !== today.getTime()) {
      throw new ServiceError("workout_today_only", 400);
    }

    if (!log.completed) {
      throw new ServiceError("workout_not_completed", 400);
    }

    const updated = await this.prisma.workout_logs.update({
      where: { id: logId },
      data: { completed: false },
    });

    const dayCompleted = await this.isDayCompleted(clientId, updated.workout_plan_id, updated.workout_day_id, updated.workout_date);

    return {
      workout_log: {
        id: updated.id,
        workout_date: updated.workout_date,
        completed: updated.completed,
      },
      day_completed: dayCompleted,
    };
  }

  private async isDayCompleted(clientId: string, planId: string, dayId: string, date: Date): Promise<boolean> {
    const day = await this.prisma.workout_days.findUnique({
      where: { id: dayId },
      include: { workout_day_exercises: true },
    });

    if (!day || day.is_rest) return true;

    const totalExercises = day.workout_day_exercises.length;
    if (totalExercises === 0) return true;

    const logs = await this.prisma.workout_logs.findMany({
      where: {
        client_id: clientId,
        workout_plan_id: planId,
        workout_day_id: dayId,
        workout_date: date,
      },
    });

    return logs.every((l: any) => l.completed);
  }

  async getHistory(userId: string, from?: string, to?: string) {
    const clientId = await this.getClientProfileId(userId);

    const fromDate = from ? new Date(from + "T00:00:00Z") : new Date(new Date().setDate(new Date().getDate() - 30));
    const toDate = to ? new Date(new Date(to + "T00:00:00Z").getTime() + 86_400_000) : new Date();

    const logs = await this.prisma.workout_logs.findMany({
      where: {
        client_id: clientId,
        workout_date: { gte: fromDate, lt: toDate },
      },
      orderBy: { workout_date: "asc" },
    });

    const dateMap = new Map<string, { total: number; completed: number }>();

    for (const log of logs) {
      const dateKey = new Date(log.workout_date).toISOString().split("T")[0];
      const existing = dateMap.get(dateKey) || { total: 0, completed: 0 };
      existing.total += 1;
      if (log.completed) existing.completed += 1;
      dateMap.set(dateKey, existing);
    }

    const history = Array.from(dateMap.entries()).map(([date, stats]) => ({
      date,
      total: stats.total,
      completed: stats.completed,
      all_completed: stats.total > 0 && stats.completed === stats.total,
    }));

    return { history };
  }
}
