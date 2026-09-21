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
        { name: { contains: filters.search, mode: "insensitive" } },
        { aliases: { has: filters.search } },
      ];
    }
    if (filters.bodyPart) where.bodyPart = filters.bodyPart;
    if (filters.target) where.target = filters.target;
    if (filters.secondaryMuscle) where.secondaryMuscles = { has: filters.secondaryMuscle };
    if (filters.equipment) where.equipment = filters.equipment;
    if (filters.difficulty) where.difficulty = filters.difficulty;
    if (filters.muscleGroup) where.muscleGroup = filters.muscleGroup;
    if (filters.compound !== undefined) where.compound = filters.compound;
    if (filters.unilateral !== undefined) where.unilateral = filters.unilateral;

    const [items, total] = await Promise.all([
      this.prisma.exercises.findMany({
        where,
        orderBy: { name: "asc" },
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
