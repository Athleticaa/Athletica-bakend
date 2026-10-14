import { Prisma, PrismaClient } from "@prisma/client";
import { injectable, inject } from "tsyringe";
import { PrismaClientToken } from "../../di/tokens";
import { config } from "../../config";
import { CacheService, CacheHit, cacheKeys, hashQuery } from "../../lib/cache";
import { ServiceError } from "../../lib/service-error";
import { buildPagination } from "./nutrition.utils";
import type { ListFoodsQuery } from "./nutrition.validation";

type FoodWithCategory = Prisma.foodsGetPayload<{ include: { category: true } }>;
type FoodCategoryWithCount = Prisma.food_categoriesGetPayload<{ include: { _count: { select: { foods: true } } } }>;
interface FoodListResult {
  items: FoodWithCategory[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface IFoodService {
  listFoods(query: ListFoodsQuery): Promise<CacheHit<FoodListResult>>;
  getFood(id: string): Promise<CacheHit<FoodWithCategory>>;
  listFoodCategories(): Promise<CacheHit<FoodCategoryWithCount[]>>;
}

@injectable()
export class FoodService implements IFoodService {
  constructor(@inject(PrismaClientToken) private prisma: PrismaClient) {}

  async listFoods(query: ListFoodsQuery): Promise<CacheHit<FoodListResult>> {
    // All search fields are case-insensitive `contains` (name/name_en/name_ar),
    // so lowercasing the hash input is safe — unlike exercises (aliases `has`).
    const normalized = {
      filters: { ...query.filters, search: query.filters.search?.toLowerCase() },
      page: query.page,
      pageSize: query.pageSize,
    };
    const key = cacheKeys.foodList(hashQuery(normalized));
    return CacheService.getOrSet(key, config.cache.ttlSec.foodList, () => this.loadFoods(query));
  }

  private async loadFoods(query: ListFoodsQuery): Promise<FoodListResult> {
    const { filters, page, pageSize } = query;
    const where: Prisma.foodsWhereInput = {};

    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: "insensitive" } },
        { name_en: { contains: filters.search, mode: "insensitive" } },
        { name_ar: { contains: filters.search, mode: "insensitive" } },
      ];
    }
    if (filters.categoryId) where.category_id = filters.categoryId;
    if (filters.isArchived !== undefined) where.is_archived = filters.isArchived;

    const ranges: Array<[number | undefined, number | undefined, "calories" | "protein" | "carbs" | "fat"]> = [
      [filters.minCalories, filters.maxCalories, "calories"],
      [filters.minProtein, filters.maxProtein, "protein"],
      [filters.minCarbs, filters.maxCarbs, "carbs"],
      [filters.minFat, filters.maxFat, "fat"],
    ];

    for (const [min, max, field] of ranges) {
      if (min === undefined && max === undefined) continue;
      where[field] = {
        ...(min !== undefined ? { gte: min } : {}),
        ...(max !== undefined ? { lte: max } : {}),
      };
    }

    const [items, total] = await Promise.all([
      this.prisma.foods.findMany({
        where,
        orderBy: { name: "asc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { category: true },
      }),
      this.prisma.foods.count({ where }),
    ]);

    return {
      items,
      pagination: buildPagination(page, pageSize, total),
    };
  }

  async getFood(id: string): Promise<CacheHit<FoodWithCategory>> {
    const key = cacheKeys.foodItem(id);
    return CacheService.getOrSet(key, config.cache.ttlSec.foodItem, () => this.loadFood(id));
  }

  private async loadFood(id: string): Promise<FoodWithCategory> {
    const food = await this.prisma.foods.findUnique({ where: { id }, include: { category: true } });
    if (!food) throw new ServiceError("food_not_found", 404);
    return food;
  }

  async listFoodCategories(): Promise<CacheHit<FoodCategoryWithCount[]>> {
    return CacheService.getOrSet(cacheKeys.foodCategories(), config.cache.ttlSec.foodCategories, () =>
      this.prisma.food_categories.findMany({
        orderBy: { name: "asc" },
        include: { _count: { select: { foods: true } } },
      }),
    );
  }
}
