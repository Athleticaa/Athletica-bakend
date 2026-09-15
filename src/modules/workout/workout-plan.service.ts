import { injectable, inject } from "tsyringe";
import { PrismaClientToken } from "../../di/tokens";
import { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { ServiceError } from "../../lib/service-error";
import { WorkoutBaseService } from "./workout.base.service";
import { toPlanResponse, toPlanSummaryResponse } from "./workout-plan.response-mappers";
import { todayDateOnly } from "../nutrition/nutrition.utils";

@injectable()
export class WorkoutPlanService extends WorkoutBaseService {
  constructor(@inject(PrismaClientToken) prisma: PrismaClient) {
    super(prisma);
  }

  async assignPlan(input: {
    coachId: string;
    coachClientId: string;
    templateId: string;
    title?: string;
    description?: string;
  }) {
    const { coachId, coachClientId, templateId, title, description } = input;

    await this.getCoachClientId(coachId, coachClientId);

    const template = await this.getOwnedTemplate(coachId, templateId);

    if (!template.workout_template_days || template.workout_template_days.length === 0) {
      throw new ServiceError("template_has_no_days", 400);
    }

    const exerciselessDays = template.workout_template_days.filter(
      (day: any) => !day.is_rest && (!day.workout_template_exercises || day.workout_template_exercises.length === 0)
    );
    if (exerciselessDays.length > 0) {
      throw new ServiceError("template_has_no_exercises", 400);
    }

    const cycle_days = Math.min(template.workout_template_days.length, 7);

    // Server-generated start date: always today (UTC midnight for `@db.Date`).
    // Never taken from body/request.
    const effectiveStartDate = todayDateOnly();

    await this.prisma.workout_plans.updateMany({
      where: { coach_client_id: coachClientId, is_active: true, deleted_at: null },
      data: { is_active: false },
    });

    const plan = await this.prisma.workout_plans.create({
      data: {
        coach_id: coachId,
        coach_client_id: coachClientId,
        workout_template_id: templateId,
        title: title ?? template.title,
        description: description ?? template.description,
        start_date: effectiveStartDate,
        cycle_days: cycle_days,
        workout_days: {
          create: template.workout_template_days.map((day: any) => ({
            title: day.title,
            day_number: day.day_number,
            is_rest: day.is_rest,
            note: day.note ?? "",
            workout_day_exercises: {
              create: day.workout_template_exercises.map((ex: any) => ({
                exercise_id: ex.exercise_id,
                order_number: ex.exercise_order,
                sets: null,
                reps: null,
                rest_time: null,
                notes: ex.notes,
              })),
            },
          })),
        },
      },
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

    return toPlanResponse(plan);
  }

  async listClientPlans(query: { coachId: string; clientId?: string; isActive?: boolean; page?: number; pageSize?: number }) {
    const { coachId, clientId, isActive = true, page = 1, pageSize = 10 } = query;

    const where: Prisma.workout_plansWhereInput = {
      coach_id: coachId,
      deleted_at: null,
      ...(isActive !== undefined ? { is_active: isActive } : {}),
      ...(clientId ? { coach_client_id: clientId } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.workout_plans.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
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
      }),
      this.prisma.workout_plans.count({ where }),
    ]);

    return {
      items: items.map(toPlanSummaryResponse),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async getClientPlan(planId: string, coachId: string) {
    const plan = await this.getOwnedPlan(coachId, planId);

    return toPlanResponse(plan);
  }

  async updatePlan(planId: string, coachId: string, input: { title?: string; description?: string }) {
    const existing = await this.getOwnedPlan(coachId, planId);

    const plan = await this.prisma.workout_plans.update({
      where: { id: planId },
      data: {
        title: input.title ?? existing.title,
        description: input.description ?? existing.description,
      },
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

    return toPlanResponse(plan);
  }

  async deletePlan(planId: string, coachId: string) {
    const existing = await this.getOwnedPlan(coachId, planId);

    await this.prisma.workout_plans.update({
      where: { id: planId },
      data: { deleted_at: new Date(), is_active: false },
    });

    return toPlanResponse(existing);
  }

  // =========================================================================
  // Plan Day Management (US5)
  // =========================================================================

  async addDayToPlan(planId: string, coachId: string, input: { title: string; note?: string }) {
    await this.getOwnedPlan(coachId, planId);

    let day;
    for (let attempt = 0; attempt < 3; attempt++) {
      const maxDay = await this.prisma.workout_days.findFirst({
        where: { workout_plan_id: planId },
        orderBy: { day_number: "desc" },
        select: { day_number: true },
      });
      const nextDayNumber = (maxDay?.day_number ?? 0) + 1;

      try {
        day = await this.prisma.workout_days.create({
          data: {
            workout_plan_id: planId,
            title: input.title,
            day_number: nextDayNumber,
            is_rest: false,
            note: input.note ?? "",
          },
        });
        break;
      } catch (err: any) {
        if (err.code === "P2002" && attempt < 2) continue;
        throw err;
      }
    }

    const updated = await this.getOwnedPlan(coachId, planId);
    return toPlanResponse(updated);
  }

  async updatePlanDay(planId: string, coachId: string, dayId: string, input: { title?: string; day_number?: number; is_rest?: boolean; note?: string }) {
    await this.getOwnedPlan(coachId, planId);
    const day = await this.getOwnedPlanDay(planId, dayId);

    const wasRest = day.is_rest;
    const willBeRest = input.is_rest ?? day.is_rest;

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.workout_days.update({
          where: { id: dayId },
          data: {
            title: input.title ?? day.title,
            day_number: input.day_number ?? day.day_number,
            is_rest: willBeRest,
            note: input.note ?? day.note,
          },
        });

        if (!wasRest && willBeRest) {
          await tx.workout_exercise_logs.deleteMany({
            where: { workout_day_id: dayId },
          });
          await tx.workout_day_exercises.deleteMany({
            where: { workout_day_id: dayId },
          });
        }
      });
    } catch (err: any) {
      if (err.code === "P2002") {
        throw new ServiceError("day_number_conflict", 409);
      }
      throw err;
    }

    const updated = await this.getOwnedPlan(coachId, planId);
    return toPlanResponse(updated);
  }

  async deletePlanDay(planId: string, coachId: string, dayId: string) {
    await this.getOwnedPlan(coachId, planId);
    await this.getOwnedPlanDay(planId, dayId);

    await this.prisma.$transaction(async (tx) => {
      await tx.workout_exercise_logs.deleteMany({ where: { workout_day_id: dayId } });
      await tx.workout_logs.deleteMany({ where: { workout_day_id: dayId } });
      await tx.workout_days.delete({ where: { id: dayId } });

      const remainingDays = await tx.workout_days.findMany({
        where: { workout_plan_id: planId },
        orderBy: { day_number: "asc" },
        select: { id: true },
      });

      for (let i = 0; i < remainingDays.length; i++) {
        await tx.workout_days.update({
          where: { id: remainingDays[i].id },
          data: { day_number: i + 1 },
        });
      }
    });

    const updated = await this.getOwnedPlan(coachId, planId);
    return toPlanResponse(updated);
  }

  async reorderPlanDays(planId: string, coachId: string, dayIds: string[]) {
    await this.getOwnedPlan(coachId, planId);

    const allDays = await this.prisma.workout_days.findMany({
      where: { workout_plan_id: planId },
      select: { id: true },
    });

    if (allDays.length !== dayIds.length) {
      throw new ServiceError("day_orders_incomplete", 400);
    }

    const allIds = new Set(allDays.map((d) => d.id));
    for (const id of dayIds) {
      if (!allIds.has(id)) {
        throw new ServiceError("workout_day_not_found", 404);
      }
    }

    await this.prisma.$transaction(async (tx) => {
      for (let i = 0; i < dayIds.length; i++) {
        await tx.workout_days.update({
          where: { id: dayIds[i] },
          data: { day_number: -(i + 1) },
        });
      }

      for (let i = 0; i < dayIds.length; i++) {
        await tx.workout_days.update({
          where: { id: dayIds[i] },
          data: { day_number: i + 1 },
        });
      }
    });

    const updated = await this.getOwnedPlan(coachId, planId);
    return toPlanResponse(updated);
  }

  // =========================================================================
  // Plan Exercise Management (US4)
  // =========================================================================

  async addExerciseToPlanDay(planId: string, coachId: string, dayId: string, input: { exercise_id: string; order_number?: number; sets?: number | null; reps?: number | null; rest_time?: number | null; notes?: string }) {
    await this.getOwnedPlan(coachId, planId);
    const day = await this.getOwnedPlanDay(planId, dayId);

    if (day.is_rest) {
      throw new ServiceError("is_rest_invalid", 400);
    }

    await this.validateExerciseExists(input.exercise_id);

    let exercise;
    for (let attempt = 0; attempt < 3; attempt++) {
      const maxEx = await this.prisma.workout_day_exercises.findFirst({
        where: { workout_day_id: dayId },
        orderBy: { order_number: "desc" },
        select: { order_number: true },
      });
      const nextOrder = (maxEx?.order_number ?? 0) + 1;

      try {
        exercise = await this.prisma.workout_day_exercises.create({
          data: {
            workout_day_id: dayId,
            exercise_id: input.exercise_id,
            order_number: input.order_number ?? nextOrder,
            sets: input.sets ?? null,
            reps: input.reps ?? null,
            rest_time: input.rest_time ?? null,
            notes: input.notes ?? "",
          },
        });
        break;
      } catch (err: any) {
        if (err.code === "P2002" && attempt < 2) continue;
        throw err;
      }
    }

    const updated = await this.getOwnedPlan(coachId, planId);
    return toPlanResponse(updated);
  }

  async updatePlanDayExercise(planId: string, coachId: string, dayId: string, exerciseId: string, input: { order_number?: number; sets?: number | null; reps?: number | null; rest_time?: number | null; notes?: string }) {
    await this.getOwnedPlan(coachId, planId);
    await this.getOwnedPlanDay(planId, dayId);
    await this.getPlanExercise(dayId, exerciseId);

    try {
      await this.prisma.workout_day_exercises.update({
        where: { id: exerciseId },
        data: {
          order_number: input.order_number,
          sets: input.sets,
          reps: input.reps,
          rest_time: input.rest_time,
          notes: input.notes,
        },
      });
    } catch (err: any) {
      if (err.code === "P2002") {
        throw new ServiceError("exercise_order_conflict", 409);
      }
      throw err;
    }

    const updated = await this.getOwnedPlan(coachId, planId);
    return toPlanResponse(updated);
  }

  async removeExerciseFromPlanDay(planId: string, coachId: string, dayId: string, exerciseId: string) {
    await this.getOwnedPlan(coachId, planId);
    await this.getOwnedPlanDay(planId, dayId);
    await this.getPlanExercise(dayId, exerciseId);

    await this.prisma.$transaction(async (tx) => {
      await tx.workout_exercise_logs.deleteMany({ where: { workout_day_exercise_id: exerciseId } });
      await tx.workout_day_exercises.delete({ where: { id: exerciseId } });

      const remaining = await tx.workout_day_exercises.findMany({
        where: { workout_day_id: dayId },
        orderBy: { order_number: "asc" },
        select: { id: true },
      });

      for (let i = 0; i < remaining.length; i++) {
        await tx.workout_day_exercises.update({
          where: { id: remaining[i].id },
          data: { order_number: i + 1 },
        });
      }
    });

    const updated = await this.getOwnedPlan(coachId, planId);
    return toPlanResponse(updated);
  }
}