import { Prisma, PrismaClient } from "@prisma/client";
import { injectable, inject } from "tsyringe";
import { PrismaClientToken } from "../../di/tokens";
import { ServiceError } from "../../lib/service-error";
import { buildPagination } from "./nutrition.utils";
import type { ListFoodsQuery } from "./nutrition.validation";

export interface IFoodService {
  listFoods(query: ListFoodsQuery): Promise<{
    items: Prisma.foodsGetPayload<{}>[];
    pagination: { page: number; pageSize: number; total: number; totalPages: number };
  }>;
  getFood(id: string): Promise<Prisma.foodsGetPayload<{}>>;
  listFoodCategories(): Promise<Prisma.food_categoriesGetPayload<{ include: { _count: { select: { foods: true } } } }>[]>;
}

@injectable()
export class FoodService implements IFoodService {
  constructor(@inject(PrismaClientToken) private prisma: PrismaClient) {}

  async listFoods(query: ListFoodsQuery) {
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
      }),
      this.prisma.foods.count({ where }),
    ]);

    return {
      items,
      pagination: buildPagination(page, pageSize, total),
    };
  }

  async getFood(id: string) {
    const food = await this.prisma.foods.findUnique({ where: { id } });
    if (!food) throw new ServiceError("food_not_found", 404);
    return food;
  }

  async listFoodCategories() {
    return this.prisma.food_categories.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { foods: true } } },
    });
  }
}
