import { injectable, inject } from "tsyringe";
import { PrismaClientToken } from "../../di/tokens";
import { PrismaClient } from "@prisma/client";
import { ServiceError } from "../../lib/service-error";
import { WorkoutBaseService } from "./workout.base.service";
import { todayDateOnly, daysBetween, formatDateOnly, toDateOnly, addDays } from "../nutrition/nutrition.utils";

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
      where: { coach_client: { client_id: clientId }, is_active: true, deleted_at: null },
      orderBy: { created_at: "desc" },
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

    // Rest day: no exercises to track, day counts as complete.
    if (day.is_rest) {
      return {
        workout: {
          day_id: day.id,
          title: day.title,
          day_number: day.day_number,
          is_rest: true,
          note: day.note ?? "",
          exercises: [],
          day_completed: true,
        },
      };
    }

    // Reconcile: ensure one log per exercise for today. Exercises added
    // to the plan after the first fetch get a log here and count toward
    // completion from the next fetch on.
    if (day.workout_day_exercises.length > 0) {
      await this.prisma.workout_exercise_logs.createMany({
        data: day.workout_day_exercises.map((ex: any) => ({
          workout_plan_id: plan.id,
          workout_day_id: day.id,
          workout_day_exercise_id: ex.id,
          client_id: clientId,
          workout_date: today,
          completed: false,
        })),
        skipDuplicates: true,
      });
    }

    const logs = await this.prisma.workout_exercise_logs.findMany({
      where: {
        client_id: clientId,
        workout_plan_id: plan.id,
        workout_day_id: day.id,
        workout_date: today,
      },
      include: {
        workout_day_exercise: { include: { exercise: true } },
      },
      orderBy: { workout_day_exercise: { order_number: "asc" } },
    });

    const exercises = logs.map((log: any) => ({
      log_id: log.id,
      completed: log.completed,
      completed_at: log.completed_at,
      id: log.workout_day_exercise.id,
      exercise_id: log.workout_day_exercise.exercise_id,
      order_number: log.workout_day_exercise.order_number,
      sets: log.workout_day_exercise.sets,
      reps: log.workout_day_exercise.reps,
      rest_time: log.workout_day_exercise.rest_time ?? null,
      notes: log.workout_day_exercise.notes,
      exercise: log.workout_day_exercise.exercise ?? null,
    }));

    const day_completed = logs.length > 0 ? logs.every((l: any) => l.completed) : true;

    return {
      workout: {
        day_id: day.id,
        title: day.title,
        day_number: day.day_number,
        is_rest: day.is_rest,
        note: day.note ?? "",
        exercises,
        day_completed,
      },
    };
  }

  async getMyActivePlan(userId: string) {
    const clientId = await this.getClientProfileId(userId);

    const plan = await this.prisma.workout_plans.findFirst({
      where: { coach_client: { client_id: clientId }, is_active: true, deleted_at: null },
      orderBy: { created_at: "desc" },
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
      where: { id: planId, coach_client: { client_id: clientId }, deleted_at: null },
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
          note: day.note ?? "",
          exercises: day.workout_day_exercises.map((ex: any) => ({
            id: ex.id,
            exercise_id: ex.exercise_id,
            order_number: ex.order_number,
            sets: ex.sets,
            reps: ex.reps,
            rest_time: ex.rest_time ?? null,
            notes: ex.notes,
            exercise: ex.exercise ?? null,
          })),
        })),
      },
    };
  }

  private toExerciseLogResponse(log: any) {
    if (!log.workout_day_exercise) {
      throw new ServiceError("exercise_log_not_found", 404);
    }
    return {
      log_id: log.id,
      completed: log.completed,
      completed_at: log.completed_at,
      workout_date: log.workout_date,
      id: log.workout_day_exercise.id,
      exercise_id: log.workout_day_exercise.exercise_id,
      order_number: log.workout_day_exercise.order_number,
      sets: log.workout_day_exercise.sets,
      reps: log.workout_day_exercise.reps,
      rest_time: log.workout_day_exercise.rest_time ?? null,
      notes: log.workout_day_exercise.notes,
      exercise: log.workout_day_exercise.exercise ?? null,
    };
  }

  private async checkDayCompletion(clientId: string, planId: string, dayId: string, date: Date): Promise<boolean> {
    // Count only existing logs: a newly added exercise gets its log on the
    // next getTodayWorkout fetch, and from then on it counts toward completion.
    const whereBase = { client_id: clientId, workout_plan_id: planId, workout_day_id: dayId, workout_date: date };
    const [totalLogs, completedLogs] = await Promise.all([
      this.prisma.workout_exercise_logs.count({ where: whereBase }),
      this.prisma.workout_exercise_logs.count({ where: { ...whereBase, completed: true } }),
    ]);
    if (totalLogs === 0) return true;
    return completedLogs >= totalLogs;
  }

  async completeExercise(userId: string, exerciseLogId: string) {
    const clientId = await this.getClientProfileId(userId);

    const log = await this.prisma.workout_exercise_logs.findFirst({
      where: { id: exerciseLogId, client_id: clientId },
      include: { workout_day_exercise: { include: { exercise: true } } },
    });

    if (!log) {
      throw new ServiceError("exercise_log_not_found", 404);
    }

    const today = todayDateOnly();
    if (formatDateOnly(new Date(log.workout_date)) !== formatDateOnly(today)) {
      throw new ServiceError("workout_today_only", 400);
    }

    // Already completed — return as-is (preserve original completed_at)
    if (log.completed) {
      const day_completed = await this.checkDayCompletion(clientId, log.workout_plan_id, log.workout_day_id, log.workout_date);
      return { exercise_log: this.toExerciseLogResponse(log), day_completed };
    }

    const updated = await this.prisma.workout_exercise_logs.update({
      where: { id: exerciseLogId },
      data: { completed: true, completed_at: new Date() },
      include: { workout_day_exercise: { include: { exercise: true } } },
    });

    const day_completed = await this.checkDayCompletion(clientId, log.workout_plan_id, log.workout_day_id, log.workout_date);

    return { exercise_log: this.toExerciseLogResponse(updated), day_completed };
  }

  async uncompleteExercise(userId: string, exerciseLogId: string) {
    const clientId = await this.getClientProfileId(userId);

    const log = await this.prisma.workout_exercise_logs.findFirst({
      where: { id: exerciseLogId, client_id: clientId },
      include: { workout_day_exercise: { include: { exercise: true } } },
    });

    if (!log) {
      throw new ServiceError("exercise_log_not_found", 404);
    }

    const today = todayDateOnly();
    if (formatDateOnly(new Date(log.workout_date)) !== formatDateOnly(today)) {
      throw new ServiceError("workout_today_only", 400);
    }

    if (!log.completed) {
      throw new ServiceError("exercise_not_completed", 400);
    }

    const updated = await this.prisma.workout_exercise_logs.update({
      where: { id: exerciseLogId },
      data: { completed: false, completed_at: null },
      include: { workout_day_exercise: { include: { exercise: true } } },
    });

    const day_completed = await this.checkDayCompletion(clientId, log.workout_plan_id, log.workout_day_id, log.workout_date);

    return { exercise_log: this.toExerciseLogResponse(updated), day_completed };
  }

  async getHistory(userId: string) {
    const clientId = await this.getClientProfileId(userId);
    const today = todayDateOnly();

    const plan = await this.prisma.workout_plans.findFirst({
      where: { coach_client: { client_id: clientId }, is_active: true, deleted_at: null },
      orderBy: { created_at: "desc" },
      include: {
        workout_days: {
          orderBy: { day_number: "asc" },
          include: { _count: { select: { workout_day_exercises: true } } },
        },
      },
    });

    const planStart = plan ? toDateOnly(new Date(plan.start_date)) : null;

    const logs = await this.prisma.workout_exercise_logs.findMany({
      where: {
        client_id: clientId,
        workout_date: {
          ...(planStart ? { gte: planStart } : {}),
          lte: today,
        },
      },
      include: {
        workout_day: { select: { id: true, title: true, day_number: true, is_rest: true } },
      },
      orderBy: { workout_date: "asc" },
    });

    // Range runs from the assign (start) date until today. Without an
    // active plan, fall back to dates that actually have logs.
    let rangeStart: Date | null = planStart;
    if (!rangeStart) {
      rangeStart = logs.length > 0 ? toDateOnly(new Date(logs[0].workout_date)) : null;
    }
    if (!rangeStart) {
      return { history: [] };
    }

    const logsByDate = new Map<string, typeof logs>();
    for (const log of logs) {
      const key = formatDateOnly(new Date(log.workout_date));
      const bucket = logsByDate.get(key);
      if (bucket) bucket.push(log);
      else logsByDate.set(key, [log]);
    }

    const cycleDayForDate = (date: Date) => {
      if (!plan) return null;
      const dayNumber = (daysBetween(new Date(plan.start_date), date) % plan.cycle_days) + 1;
      return plan.workout_days.find((d: any) => d.day_number === dayNumber) ?? null;
    };

    const history = [];
    for (
      let cursor = new Date(rangeStart);
      cursor.getTime() <= today.getTime();
      cursor = addDays(cursor, 1)
    ) {
      const dateKey = formatDateOnly(cursor);
      const dayLogs = logsByDate.get(dateKey) ?? [];

      if (dayLogs.length > 0) {
        const day = dayLogs[0].workout_day;
        const completed = dayLogs.filter((l: any) => l.completed).length;
        history.push({
          date: dateKey,
          day_id: day.id,
          day_number: day.day_number,
          title: day.title,
          is_rest: day.is_rest,
          total_exercises: dayLogs.length,
          completed_exercises: completed,
          all_completed: dayLogs.length > 0 && completed >= dayLogs.length,
        });
        continue;
      }

      // No logs this date (missed day, or rest day which never gets logs).
      const expected = cycleDayForDate(cursor);
      if (!expected) continue;
      const expectedTotal = (expected as any)._count?.workout_day_exercises ?? 0;
      history.push({
        date: dateKey,
        day_id: expected.id,
        day_number: expected.day_number,
        title: expected.title,
        is_rest: expected.is_rest,
        total_exercises: expectedTotal,
        completed_exercises: 0,
        all_completed: expected.is_rest,
      });
    }

    return { history };
  }
}
