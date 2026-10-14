import { Prisma, PrismaClient } from "@prisma/client";
import { injectable, container } from "tsyringe";
import { PrismaClientToken } from "../../di/tokens";
import { config } from "../../config";
import { CacheService, CacheHit, cacheKeys, hashQuery } from "../../lib/cache";
import { ServiceError } from "../../lib/service-error";
import type { ListExercisesQuery } from "./workout.validation";

export interface ExerciseListResult {
  items: Prisma.exercisesGetPayload<Record<string, never>>[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

@injectable()
export class WorkoutService {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = container.resolve(PrismaClientToken);
  }

  async listExercises(query: ListExercisesQuery): Promise<CacheHit<ExerciseListResult>> {
    // Hash input uses the raw (trimmed) search: the DB query is NOT fully
    // case-insensitive (aliases `has` is an exact match), so lowercasing here
    // would alias case-variants with different results onto one key.
    const normalized = {
      filters: { ...query.filters },
      page: query.page,
      pageSize: query.pageSize,
    };
    const key = cacheKeys.exerciseList(hashQuery(normalized));
    return CacheService.getOrSet(key, config.cache.ttlSec.exerciseList, () => this.loadExercises(query));
  }

  private async loadExercises(query: ListExercisesQuery): Promise<ExerciseListResult> {
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

  async getExercise(id: string): Promise<CacheHit<Prisma.exercisesGetPayload<Record<string, never>>>> {
    const key = cacheKeys.exerciseItem(id);
    return CacheService.getOrSet(key, config.cache.ttlSec.exerciseItem, () => this.loadExercise(id));
  }

  private async loadExercise(id: string) {
    const exercise = await this.prisma.exercises.findUnique({ where: { id } });
    if (!exercise) throw new ServiceError("exercise_not_found", 404);
    return exercise;
  }
}
