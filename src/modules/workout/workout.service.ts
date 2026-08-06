import { Prisma, PrismaClient } from "@prisma/client";
import { injectable, container } from "tsyringe";
import { PrismaClientToken } from "../../di/tokens";
import { ServiceError } from "../../lib/service-error";
import type { ListExercisesQuery } from "./workout.validation";

@injectable()
export class WorkoutService {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = container.resolve(PrismaClientToken);
  }

  async listExercises(query: ListExercisesQuery) {
    const { filters, page, pageSize } = query;
    const where: Prisma.exercisesWhereInput = {};

    if (filters.search) {
      where.OR = [
        { name_en: { contains: filters.search, mode: "insensitive" } },
        { name_ar: { contains: filters.search, mode: "insensitive" } },
      ];
    }
    if (filters.primaryMuscle) where.primary_muscle = filters.primaryMuscle;
    if (filters.secondaryMuscle) where.secondary_muscles = { has: filters.secondaryMuscle };
    if (filters.equipment) where.equipment = filters.equipment;
    if (filters.difficulty) where.difficulty = filters.difficulty;
    if (filters.exerciseType) where.exercise_type = filters.exerciseType;
    if (filters.movementPattern) where.movement_pattern = filters.movementPattern;
    if (filters.workoutLocation) where.workout_location = filters.workoutLocation;
    if (filters.priority) where.priority = filters.priority;
    if (filters.isDefault !== undefined) where.is_default = filters.isDefault;
    if (filters.goal) where.fitness_goals = { has: filters.goal };
    if (filters.tag) where.tags = { has: filters.tag };
    if (filters.classification) where.classification = { has: filters.classification };

    const [items, total] = await Promise.all([
      this.prisma.exercises.findMany({
        where,
        orderBy: { name_en: "asc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.exercises.count({ where }),
    ]);

    return {
      items,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async getExercise(id: string) {
    const exercise = await this.prisma.exercises.findUnique({ where: { id } });
    if (!exercise) throw new ServiceError("exercise_not_found", 404);
    return exercise;
  }
}
