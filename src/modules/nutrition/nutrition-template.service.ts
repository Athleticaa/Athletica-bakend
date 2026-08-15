import { Prisma, PrismaClient } from "@prisma/client";
import { injectable, inject } from "tsyringe";
import { PrismaClientToken } from "../../di/tokens";
import { ServiceError } from "../../lib/service-error";
import { paginate, toFoodPayload, type FoodWithData } from "./nutrition.utils";
import { NutritionBaseService } from "./base.service";
import type {
  PaginatedQuery,
  CreateTemplateInput,
  UpdateTemplateInput,
  CreateMealInput,
  UpdateMealInput,
  ReorderMealsInput,
  CreateTemplateFoodInput,
  UpdateTemplateFoodInput,
} from "./nutrition.validation";

// ============================================================================
// Response mappers
// ============================================================================

type TemplateFoodsWithData = Array<FoodWithData>;

function toTemplateResponse(t: {
  id: string;
  title: string;
  description: string;
  created_at: Date;
  _count: { nutrition_template_meals: number };
}) {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    meal_count: t._count.nutrition_template_meals,
    created_at: t.created_at,
  };
}

function toMealResponse(m: {
  id: string;
  meal_type: string;
  meal_order: number;
  notes: string;
  nutrition_template_foods?: TemplateFoodsWithData;
}, lang?: string) {
  return {
    id: m.id,
    meal_type: m.meal_type,
    meal_order: m.meal_order,
    notes: m.notes,
    foods: (m.nutrition_template_foods ?? []).map((f) => toFoodPayload(f, lang)),
  };
}

// ============================================================================
// Response types for DI interface
// ============================================================================

type TemplateResponse = {
  id: string;
  title: string;
  description: string;
  meal_count: number;
  created_at: Date;
};

type MealResponse = {
  id: string;
  meal_type: string;
  meal_order: number;
  notes: string;
  foods: ReturnType<typeof toFoodPayload>[];
};

type FoodResponse = ReturnType<typeof toFoodPayload>;

// ============================================================================
// Interface for DI
// ============================================================================

export interface INutritionTemplateService {
  createTemplate(userId: string, input: CreateTemplateInput): Promise<TemplateResponse>;
  listTemplates(userId: string, query: PaginatedQuery): Promise<{
    templates: TemplateResponse[];
    pagination: { page: number; pageSize: number; total: number; totalPages: number };
  }>;
  getTemplate(userId: string, id: string, lang?: string): Promise<TemplateResponse & { meals: MealResponse[] }>;
  updateTemplate(userId: string, id: string, input: UpdateTemplateInput): Promise<TemplateResponse>;
  deleteTemplate(userId: string, id: string): Promise<{ messageKey: string }>;
  addMealToTemplate(userId: string, templateId: string, input: CreateMealInput, lang?: string): Promise<{
    meal: MealResponse;
    template: { id: string; meal_count: number };
  }>;
  updateTemplateMeal(userId: string, templateId: string, mealId: string, input: UpdateMealInput, lang?: string): Promise<{
    meal: MealResponse;
  }>;
  deleteTemplateMeal(userId: string, templateId: string, mealId: string): Promise<{
    messageKey: string;
    template: { id: string; meal_count: number };
  }>;
  reorderTemplateMeals(userId: string, templateId: string, input: ReorderMealsInput, lang?: string): Promise<{
    meals: MealResponse[];
  }>;
  addFoodToTemplateMeal(userId: string, templateId: string, mealId: string, input: CreateTemplateFoodInput, lang?: string): Promise<{
    food: FoodResponse;
    meal: { id: string; food_count: number };
  }>;
  updateTemplateFood(userId: string, templateId: string, mealId: string, foodId: string, input: UpdateTemplateFoodInput, lang?: string): Promise<{
    food: FoodResponse;
  }>;
  removeFoodFromTemplateMeal(userId: string, templateId: string, mealId: string, foodId: string): Promise<{
    messageKey: string;
    meal: { id: string; food_count: number };
  }>;
}

@injectable()
export class NutritionTemplateService extends NutritionBaseService implements INutritionTemplateService {
  constructor(@inject(PrismaClientToken) prisma: PrismaClient) {
    super(prisma);
  }

  // ==========================================================================
  // Template CRUD (US1)
  // ==========================================================================

  async createTemplate(userId: string, input: CreateTemplateInput) {
    const coachId = await this.getCoachProfileId(userId);
    const template = await this.prisma.nutrition_templates.create({
      data: {
        coach_id: coachId,
        title: input.title.trim(),
        description: input.description.trim(),
      },
      include: { _count: { select: { nutrition_template_meals: true } } },
    });
    return toTemplateResponse(template);
  }

  async listTemplates(userId: string, query: PaginatedQuery) {
    const coachId = await this.getCoachProfileId(userId);
    const where: Prisma.nutrition_templatesWhereInput = {
      coach_id: coachId,
      is_deleted: false,
    };

    const { items, pagination } = await paginate(
      this.prisma.nutrition_templates.findMany({
        where,
        include: { _count: { select: { nutrition_template_meals: true } } },
        orderBy: { created_at: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.nutrition_templates.count({ where }),
      query
    );

    return {
      templates: items.map((t) => toTemplateResponse(t)),
      pagination,
    };
  }

  async getTemplate(userId: string, id: string, lang?: string) {
    const coachId = await this.getCoachProfileId(userId);
    const template = await this.prisma.nutrition_templates.findFirst({
      where: { id, coach_id: coachId, is_deleted: false },
      include: {
        _count: { select: { nutrition_template_meals: true } },
        nutrition_template_meals: {
          orderBy: { meal_order: "asc" },
          include: { nutrition_template_foods: { include: { food: true } } },
        },
      },
    });
    if (!template) throw new ServiceError("template_not_found", 404);

    return {
      id: template.id,
      title: template.title,
      description: template.description,
      meal_count: template._count.nutrition_template_meals,
      created_at: template.created_at,
      meals: template.nutrition_template_meals.map((m) => toMealResponse(m, lang)),
    };
  }

  async updateTemplate(userId: string, id: string, input: UpdateTemplateInput) {
    const coachId = await this.getCoachProfileId(userId);
    await this.getOwnedTemplate(coachId, id);
    const template = await this.prisma.nutrition_templates.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description.trim() } : {}),
      },
      include: { _count: { select: { nutrition_template_meals: true } } },
    });
    return toTemplateResponse(template);
  }

  async deleteTemplate(userId: string, id: string) {
    const coachId = await this.getCoachProfileId(userId);
    await this.getOwnedTemplate(coachId, id);

    await this.prisma.$transaction(async (tx) => {
      const activePlanCount = await tx.nutrition_plans.count({
        where: { nutrition_template_id: id, is_active: true },
      });
      if (activePlanCount > 0) throw new ServiceError("template_has_active_plans", 400);

      return tx.nutrition_templates.update({
        where: { id },
        data: { is_deleted: true },
      });
    });

    return { messageKey: "template_deleted" };
  }

  // ==========================================================================
  // Template Meal CRUD (US2)
  // ==========================================================================

  async addMealToTemplate(userId: string, templateId: string, input: CreateMealInput, lang?: string) {
    const coachId = await this.getCoachProfileId(userId);
    await this.getOwnedTemplate(coachId, templateId);

    // Concurrent adds can compute the same maxOrder and one of them hits the
    // unique constraint — retry once with a freshly computed order.
    let meal: Prisma.nutrition_template_mealsGetPayload<{
      include: { nutrition_template_foods: { include: { food: true } } };
    }> | null = null;
    for (let attempt = 0; attempt < 2 && !meal; attempt++) {
      try {
        meal = await this.prisma.$transaction(async (tx) => {
          // Missing or out-of-range meal_order -> append at the end
          const maxOrder =
            (
              await tx.nutrition_template_meals.aggregate({
                where: { nutrition_template_id: templateId },
                _max: { meal_order: true },
              })
            )._max.meal_order ?? 0;
          const mealOrder = input.meal_order === undefined || input.meal_order > maxOrder + 1 ? maxOrder + 1 : input.meal_order;

          await tx.nutrition_template_meals.updateMany({
            where: { nutrition_template_id: templateId, meal_order: { gte: mealOrder } },
            data: { meal_order: { increment: 1 } },
          });
          return tx.nutrition_template_meals.create({
            data: {
              nutrition_template_id: templateId,
              meal_type: input.meal_type,
              meal_order: mealOrder,
              notes: (input.notes ?? "").trim(),
            },
            include: { nutrition_template_foods: { include: { food: true } } },
          });
        });
      } catch (err) {
        if (attempt === 0 && err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
        throw err;
      }
    }

    const mealCount = await this.prisma.nutrition_template_meals.count({
      where: { nutrition_template_id: templateId },
    });
    return {
      meal: toMealResponse(meal!, lang),
      template: { id: templateId, meal_count: mealCount },
    };
  }

  async updateTemplateMeal(
    userId: string,
    templateId: string,
    mealId: string,
    input: UpdateMealInput,
    lang?: string
  ) {
    const coachId = await this.getCoachProfileId(userId);
    await this.getOwnedTemplate(coachId, templateId);
    const existing = await this.getOwnedTemplateMeal(templateId, mealId);

    const meal = await this.prisma.$transaction(async (tx) => {
      // Orders beyond the current last position clamp to the end (keep 1..N contiguous)
      const maxOrder =
        (
          await tx.nutrition_template_meals.aggregate({
            where: { nutrition_template_id: templateId },
            _max: { meal_order: true },
          })
        )._max.meal_order ?? existing.meal_order;
      const newOrder =
        input.meal_order === undefined ? undefined : Math.min(input.meal_order, maxOrder);

      if (newOrder !== undefined && newOrder !== existing.meal_order) {
        const oldOrder = existing.meal_order;
        // Sentinel first: park the moved meal at order 0 so the shift below can
        // never transiently duplicate a meal_order (DB unique constraint).
        await tx.nutrition_template_meals.update({
          where: { id: mealId },
          data: { meal_order: 0 },
        });
        if (newOrder > oldOrder) {
          await tx.nutrition_template_meals.updateMany({
            where: { nutrition_template_id: templateId, meal_order: { gt: oldOrder, lte: newOrder } },
            data: { meal_order: { decrement: 1 } },
          });
        } else {
          await tx.nutrition_template_meals.updateMany({
            where: { nutrition_template_id: templateId, meal_order: { gte: newOrder, lt: oldOrder } },
            data: { meal_order: { increment: 1 } },
          });
        }
      }
      return tx.nutrition_template_meals.update({
        where: { id: mealId },
        data: {
          ...(input.meal_type !== undefined ? { meal_type: input.meal_type } : {}),
          ...(newOrder !== undefined ? { meal_order: newOrder } : {}),
          ...(input.notes !== undefined ? { notes: input.notes.trim() } : {}),
        },
        include: { nutrition_template_foods: { include: { food: true } } },
      });
    });
    return { meal: toMealResponse(meal, lang) };
  }

  async deleteTemplateMeal(userId: string, templateId: string, mealId: string) {
    const coachId = await this.getCoachProfileId(userId);
    await this.getOwnedTemplate(coachId, templateId);
    await this.getOwnedTemplateMeal(templateId, mealId);

    await this.prisma.$transaction(async (tx) => {
      await tx.nutrition_template_foods.deleteMany({
        where: { nutrition_template_meal_id: mealId },
      });
      await tx.nutrition_template_meals.delete({ where: { id: mealId } });
    });
    const mealCount = await this.prisma.nutrition_template_meals.count({
      where: { nutrition_template_id: templateId },
    });
    return {
      messageKey: "meal_deleted",
      template: { id: templateId, meal_count: mealCount },
    };
  }

  async reorderTemplateMeals(userId: string, templateId: string, input: ReorderMealsInput, lang?: string) {
    const coachId = await this.getCoachProfileId(userId);
    await this.getOwnedTemplate(coachId, templateId);

    const ids = input.meal_orders.map((m) => m.meal_id);

    // Require ALL meal IDs to prevent partial reorders that create duplicate meal_order values
    const allMeals = await this.prisma.nutrition_template_meals.findMany({
      where: { nutrition_template_id: templateId },
      select: { id: true },
    });
    if (allMeals.length !== ids.length) throw new ServiceError("meal_orders_incomplete", 400);

    const existing = await this.prisma.nutrition_template_meals.findMany({
      where: { id: { in: ids }, nutrition_template_id: templateId },
      select: { id: true },
    });
    if (existing.length !== ids.length) throw new ServiceError("meal_not_found", 404);

    // Two-phase write: park every meal at a unique negative sentinel first, then
    // apply the final permutation — a direct swap would transiently duplicate
    // meal_order values and violate the DB unique constraint.
    try {
      await this.prisma.$transaction([
        ...input.meal_orders.map((m, i) =>
          this.prisma.nutrition_template_meals.update({
            where: { id: m.meal_id },
            data: { meal_order: -(i + 1) },
          })
        ),
        ...input.meal_orders.map((m) =>
          this.prisma.nutrition_template_meals.update({
            where: { id: m.meal_id },
            data: { meal_order: m.meal_order },
          })
        ),
      ]);
    } catch (err) {
      // Concurrent reorder raced with another order mutation
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ServiceError("meal_orders_invalid", 400);
      }
      throw err;
    }

    const meals = await this.prisma.nutrition_template_meals.findMany({
      where: { nutrition_template_id: templateId },
      orderBy: { meal_order: "asc" },
      include: { nutrition_template_foods: { include: { food: true } } },
    });
    return { meals: meals.map((m) => toMealResponse(m, lang)) };
  }

  // ==========================================================================
  // Template Meal Food CRUD (US3)
  // ==========================================================================

  async addFoodToTemplateMeal(
    userId: string,
    templateId: string,
    mealId: string,
    input: CreateTemplateFoodInput,
    lang?: string
  ) {
    const coachId = await this.getCoachProfileId(userId);
    await this.getOwnedTemplate(coachId, templateId);
    await this.getOwnedTemplateMeal(templateId, mealId);

    // Verify the food exists in the food library
    const foodExists = await this.prisma.foods.findUnique({ where: { id: input.food_id } });
    if (!foodExists) throw new ServiceError("food_not_found", 404);
    if (foodExists.is_archived) throw new ServiceError("food_archived", 400);

    // Check for duplicate food in the same meal
    const existing = await this.prisma.nutrition_template_foods.findFirst({
      where: { nutrition_template_meal_id: mealId, food_id: input.food_id },
    });
    if (existing) throw new ServiceError("food_already_in_meal", 400);

    let food: Prisma.nutrition_template_foodsGetPayload<{ include: { food: true } }>;
    try {
      food = await this.prisma.nutrition_template_foods.create({
        data: {
          nutrition_template_meal_id: mealId,
          food_id: input.food_id,
          quantity: input.quantity,
        },
        include: { food: true },
      });
    } catch (err) {
      // Unique constraint: a concurrent request added the same food first
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ServiceError("food_already_in_meal", 400);
      }
      throw err;
    }
    const foodCount = await this.prisma.nutrition_template_foods.count({
      where: { nutrition_template_meal_id: mealId },
    });
    return {
      food: toFoodPayload(food, lang),
      meal: { id: mealId, food_count: foodCount },
    };
  }

  async updateTemplateFood(
    userId: string,
    templateId: string,
    mealId: string,
    foodId: string,
    input: UpdateTemplateFoodInput,
    lang?: string
  ) {
    const coachId = await this.getCoachProfileId(userId);
    await this.getOwnedTemplate(coachId, templateId);
    await this.getOwnedTemplateMeal(templateId, mealId);
    await this.getOwnedTemplateMealFood(templateId, mealId, foodId);

    const food = await this.prisma.nutrition_template_foods.update({
      where: { id: foodId },
      data: { quantity: input.quantity },
      include: { food: true },
    });
    return { food: toFoodPayload(food, lang) };
  }

  async removeFoodFromTemplateMeal(
    userId: string,
    templateId: string,
    mealId: string,
    foodId: string
  ) {
    const coachId = await this.getCoachProfileId(userId);
    await this.getOwnedTemplate(coachId, templateId);
    await this.getOwnedTemplateMeal(templateId, mealId);
    await this.getOwnedTemplateMealFood(templateId, mealId, foodId);

    await this.prisma.nutrition_template_foods.delete({ where: { id: foodId } });
    const foodCount = await this.prisma.nutrition_template_foods.count({
      where: { nutrition_template_meal_id: mealId },
    });
    return { messageKey: "template_food_deleted", meal: { id: mealId, food_count: foodCount } };
  }
}
