import { injectable, inject } from "tsyringe";
import { PrismaClientToken } from "../../di/tokens";
import { PrismaClient } from "@prisma/client";
import { ServiceError } from "../../lib/service-error";
import { WorkoutBaseService } from "./workout.base.service";
import { toTemplateResponse, toTemplateSummaryResponse } from "./workout-template.response-mappers";

@injectable()
export class WorkoutTemplateService extends WorkoutBaseService {
  constructor(@inject(PrismaClientToken) prisma: PrismaClient) {
    super(prisma);
  }

  public async getCoachIdFromUser(userId: string): Promise<string> {
    return this.getCoachProfileId(userId);
  }

  async createTemplate(input: { title: string; description: string; coachId: string }) {
    const { title, description, coachId } = input;

    const template = await this.prisma.workout_templates.create({
      data: {
        title,
        description,
        coach_id: coachId,
      },
      include: {
        workout_template_days: {
          orderBy: { day_number: "asc" },
          include: {
            workout_template_exercises: {
              orderBy: { exercise_order: "asc" },
              include: { exercise: true },
            },
          },
        },
      },
    });

    return toTemplateResponse(template);
  }

  async listTemplates(query: { coachId: string; page?: number; pageSize?: number }) {
    const { coachId, page = 1, pageSize = 10 } = query;

    const [items, total] = await Promise.all([
      this.prisma.workout_templates.findMany({
        where: { coach_id: coachId, deleted_at: null },
        orderBy: { created_at: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          workout_template_days: {
            orderBy: { day_number: "asc" },
            include: {
              workout_template_exercises: {
                orderBy: { exercise_order: "asc" },
              },
            },
          },
        },
      }),
      this.prisma.workout_templates.count({
        where: { coach_id: coachId, deleted_at: null },
      }),
    ]);

    return {
      items: items.map(toTemplateSummaryResponse),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async getTemplate(id: string, coachId: string) {
    const template = await this.getOwnedTemplate(coachId, id);

    return toTemplateResponse(template);
  }

  async updateTemplate(id: string, coachId: string, input: { title?: string; description?: string }) {
    const existing = await this.getOwnedTemplate(coachId, id);

    const template = await this.prisma.workout_templates.update({
      where: { id },
      data: {
        title: input.title ?? existing.title,
        description: input.description ?? existing.description,
      },
      include: {
        workout_template_days: {
          orderBy: { day_number: "asc" },
          include: {
            workout_template_exercises: {
              orderBy: { exercise_order: "asc" },
              include: { exercise: true },
            },
          },
        },
      },
    });

    return toTemplateResponse(template);
  }

  async deleteTemplate(id: string, coachId: string) {
    const existing = await this.getOwnedTemplate(coachId, id);

    // Block deletion if active plans exist
    const activePlans = await this.prisma.workout_plans.count({
      where: { workout_template_id: id, is_active: true, deleted_at: null },
    });

    if (activePlans > 0) {
      throw new ServiceError("template_has_active_plans", 400);
    }

    // Soft delete
    await this.prisma.workout_templates.update({
      where: { id },
      data: { deleted_at: new Date() },
    });

    return toTemplateResponse(existing);
  }

  // =========================================================================
  // Template Day Management (US1)
  // =========================================================================

  async addDayToTemplate(templateId: string, coachId: string, input: { title: string; note?: string }) {
    await this.getOwnedTemplate(coachId, templateId);

    let day;
    for (let attempt = 0; attempt < 3; attempt++) {
      const maxDay = await this.prisma.workout_template_days.findFirst({
        where: { workout_template_id: templateId },
        orderBy: { day_number: "desc" },
        select: { day_number: true },
      });
      const nextDayNumber = (maxDay?.day_number ?? 0) + 1;

      try {
        day = await this.prisma.workout_template_days.create({
          data: {
            workout_template_id: templateId,
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

    const updated = await this.getOwnedTemplate(coachId, templateId);
    return toTemplateResponse(updated);
  }

  async updateTemplateDay(templateId: string, coachId: string, dayId: string, input: { title?: string; day_number?: number; is_rest?: boolean; note?: string }) {
    await this.getOwnedTemplate(coachId, templateId);
    const day = await this.getOwnedTemplateDay(templateId, dayId);

    const wasRest = day.is_rest;
    const willBeRest = input.is_rest ?? day.is_rest;

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.workout_template_days.update({
          where: { id: dayId },
          data: {
            title: input.title ?? day.title,
            day_number: input.day_number ?? day.day_number,
            is_rest: willBeRest,
            note: input.note ?? day.note,
          },
        });

        if (!wasRest && willBeRest) {
          await tx.workout_template_exercises.deleteMany({
            where: { workout_template_day_id: dayId },
          });
        }
      });
    } catch (err: any) {
      if (err.code === "P2002") {
        throw new ServiceError("day_number_conflict", 409);
      }
      throw err;
    }

    const updated = await this.getOwnedTemplate(coachId, templateId);
    return toTemplateResponse(updated);
  }

  async deleteTemplateDay(templateId: string, coachId: string, dayId: string) {
    await this.getOwnedTemplate(coachId, templateId);
    await this.getOwnedTemplateDay(templateId, dayId);

    await this.prisma.$transaction(async (tx) => {
      await tx.workout_template_days.delete({ where: { id: dayId } });

      const remainingDays = await tx.workout_template_days.findMany({
        where: { workout_template_id: templateId },
        orderBy: { day_number: "asc" },
        select: { id: true },
      });

      for (let i = 0; i < remainingDays.length; i++) {
        await tx.workout_template_days.update({
          where: { id: remainingDays[i].id },
          data: { day_number: i + 1 },
        });
      }
    });

    const updated = await this.getOwnedTemplate(coachId, templateId);
    return toTemplateResponse(updated);
  }

  async reorderTemplateDays(templateId: string, coachId: string, dayIds: string[]) {
    await this.getOwnedTemplate(coachId, templateId);

    const allDays = await this.prisma.workout_template_days.findMany({
      where: { workout_template_id: templateId },
      select: { id: true },
    });

    if (allDays.length !== dayIds.length) {
      throw new ServiceError("day_orders_incomplete", 400);
    }

    const allIds = new Set(allDays.map((d) => d.id));
    for (const id of dayIds) {
      if (!allIds.has(id)) {
        throw new ServiceError("day_not_found", 404);
      }
    }

    // Two-phase write in a transaction: park at negative sentinels, then apply final order
    await this.prisma.$transaction(async (tx) => {
      for (let i = 0; i < dayIds.length; i++) {
        await tx.workout_template_days.update({
          where: { id: dayIds[i] },
          data: { day_number: -(i + 1) },
        });
      }

      for (let i = 0; i < dayIds.length; i++) {
        await tx.workout_template_days.update({
          where: { id: dayIds[i] },
          data: { day_number: i + 1 },
        });
      }
    });

    const updated = await this.getOwnedTemplate(coachId, templateId);
    return toTemplateResponse(updated);
  }

  // =========================================================================
  // Template Exercise Management (US1)
  // =========================================================================

  async addExerciseToTemplateDay(templateId: string, coachId: string, dayId: string, input: { exercise_id: string; exercise_order?: number; notes?: string }) {
    await this.getOwnedTemplate(coachId, templateId);
    const day = await this.getOwnedTemplateDay(templateId, dayId);

    if (day.is_rest) {
      throw new ServiceError("is_rest_invalid", 400);
    }

    await this.validateExerciseExists(input.exercise_id);

    let exercise;
    for (let attempt = 0; attempt < 3; attempt++) {
      const maxEx = await this.prisma.workout_template_exercises.findFirst({
        where: { workout_template_day_id: dayId },
        orderBy: { exercise_order: "desc" },
        select: { exercise_order: true },
      });
      const nextExerciseOrder = (maxEx?.exercise_order ?? 0) + 1;

      try {
        exercise = await this.prisma.workout_template_exercises.create({
          data: {
            workout_template_day_id: dayId,
            exercise_id: input.exercise_id,
            exercise_order: input.exercise_order ?? nextExerciseOrder,
            sets: null,
            reps: null,
            notes: input.notes ?? "",
          },
        });
        break;
      } catch (err: any) {
        if (err.code === "P2002" && attempt < 2) continue;
        throw err;
      }
    }

    const updated = await this.getOwnedTemplate(coachId, templateId);
    return toTemplateResponse(updated);
  }

  async updateTemplateDayExercise(templateId: string, coachId: string, dayId: string, exerciseId: string, input: { exercise_order?: number; notes?: string }) {
    await this.getOwnedTemplate(coachId, templateId);
    await this.getOwnedTemplateDay(templateId, dayId);
    await this.getTemplateExercise(dayId, exerciseId);

    try {
      await this.prisma.workout_template_exercises.update({
        where: { id: exerciseId },
        data: {
          exercise_order: input.exercise_order,
          notes: input.notes,
        },
      });
    } catch (err: any) {
      if (err.code === "P2002") {
        throw new ServiceError("exercise_order_conflict", 409);
      }
      throw err;
    }

    const updated = await this.getOwnedTemplate(coachId, templateId);
    return toTemplateResponse(updated);
  }

  async removeExerciseFromTemplateDay(templateId: string, coachId: string, dayId: string, exerciseId: string) {
    await this.getOwnedTemplate(coachId, templateId);
    await this.getOwnedTemplateDay(templateId, dayId);
    await this.getTemplateExercise(dayId, exerciseId);

    await this.prisma.$transaction(async (tx) => {
      await tx.workout_template_exercises.delete({ where: { id: exerciseId } });

      const remainingExercises = await tx.workout_template_exercises.findMany({
        where: { workout_template_day_id: dayId },
        orderBy: { exercise_order: "asc" },
        select: { id: true },
      });

      for (let i = 0; i < remainingExercises.length; i++) {
        await tx.workout_template_exercises.update({
          where: { id: remainingExercises[i].id },
          data: { exercise_order: i + 1 },
        });
      }
    });

    const updated = await this.getOwnedTemplate(coachId, templateId);
    return toTemplateResponse(updated);
  }
}