import { Prisma, PrismaClient } from "@prisma/client";
import { injectable, inject } from "tsyringe";
import { PrismaClientToken } from "../../di/tokens";
import { ServiceError } from "../../lib/service-error";
import { paginate, toFoodPayload, type FoodWithData } from "./nutrition.utils";
import { NutritionBaseService } from "./base.service";
import type {
  AssignPlanInput,
  ListClientPlansQuery,
  CreateMealInput,
  UpdateMealInput,
  ReorderMealsInput,
  CreateTemplateFoodInput,
  UpdateTemplateFoodInput,
} from "./nutrition.validation";

// ============================================================================
// Response types
// ============================================================================

type PlanResponse = {
  id: string;
  title: string;
  description: string;
  is_active: boolean;
  created_at: Date;
  meal_count: number;
};

type PlanMealResponse = {
  id: string;
  meal_type: string;
  meal_order: number;
  notes: string;
  foods: ReturnType<typeof toFoodPayload>[];
};

type FoodResponse = ReturnType<typeof toFoodPayload>;

type PlanDetailResponse = PlanResponse & {
  meals: PlanMealResponse[];
};

// ============================================================================
// Interface for DI
// ============================================================================

export interface INutritionPlanService {
  createPlanFromTemplate(userId: string, templateId: string, input: AssignPlanInput): Promise<PlanResponse>;
  listClientPlans(userId: string, query: ListClientPlansQuery): Promise<{
    plans: PlanResponse[];
    pagination: { page: number; pageSize: number; total: number; totalPages: number };
  }>;
  getClientPlan(userId: string, planId: string, lang?: string): Promise<PlanDetailResponse>;
  deletePlan(userId: string, planId: string): Promise<{ messageKey: string }>;
  addMealToPlan(userId: string, planId: string, input: CreateMealInput, lang?: string): Promise<{
    meal: PlanMealResponse;
    plan: { id: string; meal_count: number };
  }>;
  updatePlanMeal(userId: string, planId: string, mealId: string, input: UpdateMealInput, lang?: string): Promise<{
    meal: PlanMealResponse;
  }>;
  deletePlanMeal(userId: string, planId: string, mealId: string): Promise<{
    messageKey: string;
    plan: { id: string; meal_count: number };
  }>;
  reorderPlanMeals(userId: string, planId: string, input: ReorderMealsInput, lang?: string): Promise<{
    meals: PlanMealResponse[];
  }>;
  addFoodToPlanMeal(userId: string, planId: string, mealId: string, input: CreateTemplateFoodInput, lang?: string): Promise<{
    food: FoodResponse;
    meal: { id: string; food_count: number };
  }>;
  updatePlanFood(userId: string, planId: string, mealId: string, foodId: string, input: UpdateTemplateFoodInput, lang?: string): Promise<{
    food: FoodResponse;
  }>;
  removeFoodFromPlanMeal(userId: string, planId: string, mealId: string, foodId: string): Promise<{
    messageKey: string;
    meal: { id: string; food_count: number };
  }>;
}

@injectable()
export class NutritionPlanService extends NutritionBaseService implements INutritionPlanService {
  constructor(@inject(PrismaClientToken) prisma: PrismaClient) {
    super(prisma);
  }

  private toPlanMealResponse(m: {
    id: string;
    meal_type: string;
    meal_order: number;
    notes: string;
    nutrition_meal_foods?: Array<FoodWithData>;
  }, lang?: string): PlanMealResponse {
    return {
      id: m.id,
      meal_type: m.meal_type,
      meal_order: m.meal_order,
      notes: m.notes,
      foods: (m.nutrition_meal_foods ?? []).map((f) => toFoodPayload(f, lang)),
    };
  }

  private async deactivateOldPlans(tx: Prisma.TransactionClient, coachClientId: string) {
    await tx.nutrition_plans.updateMany({
      where: { coach_client_id: coachClientId, is_active: true },
      data: { is_active: false },
    });
  }

  private toPlanResponse(p: {
    id: string;
    title: string;
    description: string;
    is_active: boolean;
    created_at: Date;
    _count?: { nutrition_meals: number };
    nutrition_meals?: unknown[];
  }): PlanResponse {
    return {
      id: p.id,
      title: p.title,
      description: p.description,
      is_active: p.is_active,
      created_at: p.created_at,
      meal_count: p._count?.nutrition_meals ?? p.nutrition_meals?.length ?? 0,
    };
  }

  // ==========================================================================
  // Plan CRUD (US4)
  // ==========================================================================

  async createPlanFromTemplate(userId: string, templateId: string, input: AssignPlanInput) {
    const coachId = await this.getCoachProfileId(userId);
    const coachClient = await this.getCoachClientId(coachId, input.coach_client_id);
    const template = await this.getOwnedTemplate(coachId, templateId);

    if (template.nutrition_template_meals.length === 0) {
      throw new ServiceError("template_has_no_meals", 400);
    }

    // Create plan with copied meals and foods in a transaction
    const plan = await this.prisma.$transaction(async (tx) => {
      // Deactivate any existing active plan for this client — only one active
      // plan per client at a time.  Plan lifecycle is driven by the
      // coach-client relationship: active until coach deletes/assigns new
      // plan, or the relationship ends.
      await this.deactivateOldPlans(tx, coachClient.id);

      const newPlan = await tx.nutrition_plans.create({
        data: {
          coach_client_id: coachClient.id,
          nutrition_template_id: templateId,
          title: input.title.trim(),
          description: (input.description ?? "").trim(),
          is_active: true,
        },
      });

      // Copy template meals to plan meals
      for (const templateMeal of template.nutrition_template_meals) {
        const planMeal = await tx.nutrition_meals.create({
          data: {
            nutrition_plan_id: newPlan.id,
            meal_type: templateMeal.meal_type,
            meal_order: templateMeal.meal_order,
            notes: templateMeal.notes,
          },
        });

        // Copy template foods to plan meal foods
        for (const templateFood of templateMeal.nutrition_template_foods) {
          await tx.nutrition_meal_foods.create({
            data: {
              nutrition_meal_id: planMeal.id,
              food_id: templateFood.food_id,
              quantity: templateFood.quantity,
            },
          });
        }
      }

      return tx.nutrition_plans.findUnique({
        where: { id: newPlan.id },
        include: { _count: { select: { nutrition_meals: true } } },
      });
    });

    return this.toPlanResponse(plan!);
  }

  async listClientPlans(userId: string, query: ListClientPlansQuery) {
    const coachId = await this.getCoachProfileId(userId);

    const where: Prisma.nutrition_plansWhereInput = {
      coach_client: {
        coach_id: coachId,
        ...(query.clientId ? { client_id: query.clientId } : {}),
      },
      ...(query.isActive !== undefined ? { is_active: query.isActive } : {}),
    };

    const { items, pagination } = await paginate(
      this.prisma.nutrition_plans.findMany({
        where,
        include: { _count: { select: { nutrition_meals: true } } },
        orderBy: { created_at: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.nutrition_plans.count({ where }),
      query
    );

    return {
      plans: items.map((p) => this.toPlanResponse(p)),
      pagination,
    };
  }

  async getClientPlan(userId: string, planId: string, lang?: string) {
    const coachId = await this.getCoachProfileId(userId);

    const plan = await this.prisma.nutrition_plans.findFirst({
      where: { id: planId, coach_client: { coach_id: coachId } },
      include: {
        nutrition_meals: {
          orderBy: { meal_order: "asc" },
          include: { nutrition_meal_foods: { include: { food: true } } },
        },
      },
    });
    if (!plan) throw new ServiceError("plan_not_found", 404);

    return {
      ...this.toPlanResponse(plan),
      meals: plan.nutrition_meals.map((m) => this.toPlanMealResponse(m, lang)),
    };
  }

  async deletePlan(userId: string, planId: string) {
    const coachId = await this.getCoachProfileId(userId);

    const plan = await this.prisma.nutrition_plans.findFirst({
      where: { id: planId, coach_client: { coach_id: coachId } },
    });
    if (!plan) throw new ServiceError("plan_not_found", 404);

    // Cascade delete meal logs then deactivate the plan so client stops seeing
    // stale logs for a plan the coach has removed.
    await this.prisma.$transaction(async (tx) => {
      await tx.nutrition_meal_logs.deleteMany({
        where: { nutrition_plan_id: planId },
      });
      await tx.nutrition_plans.update({
        where: { id: planId },
        data: { is_active: false },
      });
    });

    return { messageKey: "plan_deleted" };
  }

  // ==========================================================================
  // Plan Meal CRUD (US7)
  // ==========================================================================

  async addMealToPlan(userId: string, planId: string, input: CreateMealInput, lang?: string) {
    const coachId = await this.getCoachProfileId(userId);
    await this.getOwnedPlan(coachId, planId);

    // Concurrent adds can compute the same maxOrder and one of them hits the
    // unique constraint — retry once with a freshly computed order.
    let meal: Prisma.nutrition_mealsGetPayload<{
      include: { nutrition_meal_foods: { include: { food: true } } };
    }> | null = null;
    for (let attempt = 0; attempt < 2 && !meal; attempt++) {
      try {
        meal = await this.prisma.$transaction(async (tx) => {
          // Missing or out-of-range meal_order -> append at the end
          const maxOrder =
            (
              await tx.nutrition_meals.aggregate({
                where: { nutrition_plan_id: planId },
                _max: { meal_order: true },
              })
            )._max.meal_order ?? 0;
          const mealOrder = input.meal_order === undefined || input.meal_order > maxOrder + 1 ? maxOrder + 1 : input.meal_order;

          await tx.nutrition_meals.updateMany({
            where: { nutrition_plan_id: planId, meal_order: { gte: mealOrder } },
            data: { meal_order: { increment: 1 } },
          });
          return tx.nutrition_meals.create({
            data: {
              nutrition_plan_id: planId,
              meal_type: input.meal_type,
              meal_order: mealOrder,
              notes: (input.notes ?? "").trim(),
            },
            include: { nutrition_meal_foods: { include: { food: true } } },
          });
        });
      } catch (err) {
        if (attempt === 0 && err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
        throw err;
      }
    }

    const mealCount = await this.prisma.nutrition_meals.count({
      where: { nutrition_plan_id: planId },
    });
    return {
      meal: this.toPlanMealResponse(meal!, lang),
      plan: { id: planId, meal_count: mealCount },
    };
  }

  async updatePlanMeal(
    userId: string,
    planId: string,
    mealId: string,
    input: UpdateMealInput,
    lang?: string
  ) {
    const coachId = await this.getCoachProfileId(userId);
    await this.getOwnedPlan(coachId, planId);
    const existing = await this.getOwnedPlanMeal(planId, mealId);

    const meal = await this.prisma.$transaction(async (tx) => {
      // Orders beyond the current last position clamp to the end (keep 1..N contiguous)
      const maxOrder =
        (
          await tx.nutrition_meals.aggregate({
            where: { nutrition_plan_id: planId },
            _max: { meal_order: true },
          })
        )._max.meal_order ?? existing.meal_order;
      const newOrder =
        input.meal_order === undefined ? undefined : Math.min(input.meal_order, maxOrder);

      if (newOrder !== undefined && newOrder !== existing.meal_order) {
        const oldOrder = existing.meal_order;
        // Sentinel first: park the moved meal at order 0 so the shift below can
        // never transiently duplicate a meal_order (DB unique constraint).
        await tx.nutrition_meals.update({
          where: { id: mealId },
          data: { meal_order: 0 },
        });
        if (newOrder > oldOrder) {
          await tx.nutrition_meals.updateMany({
            where: { nutrition_plan_id: planId, meal_order: { gt: oldOrder, lte: newOrder } },
            data: { meal_order: { decrement: 1 } },
          });
        } else {
          await tx.nutrition_meals.updateMany({
            where: { nutrition_plan_id: planId, meal_order: { gte: newOrder, lt: oldOrder } },
            data: { meal_order: { increment: 1 } },
          });
        }
      }
      return tx.nutrition_meals.update({
        where: { id: mealId },
        data: {
          ...(input.meal_type !== undefined ? { meal_type: input.meal_type } : {}),
          ...(newOrder !== undefined ? { meal_order: newOrder } : {}),
          ...(input.notes !== undefined ? { notes: input.notes.trim() } : {}),
        },
        include: { nutrition_meal_foods: { include: { food: true } } },
      });
    });
    return { meal: this.toPlanMealResponse(meal, lang) };
  }

  async deletePlanMeal(userId: string, planId: string, mealId: string) {
    const coachId = await this.getCoachProfileId(userId);
    await this.getOwnedPlan(coachId, planId);
    await this.getOwnedPlanMeal(planId, mealId);

    // Logs and foods reference the meal with RESTRICT FKs — remove them first
    await this.prisma.$transaction(async (tx) => {
      await tx.nutrition_meal_logs.deleteMany({ where: { nutrition_meal_id: mealId } });
      await tx.nutrition_meal_foods.deleteMany({ where: { nutrition_meal_id: mealId } });
      await tx.nutrition_meals.delete({ where: { id: mealId } });
    });

    const mealCount = await this.prisma.nutrition_meals.count({
      where: { nutrition_plan_id: planId },
    });
    return {
      messageKey: "meal_deleted",
      plan: { id: planId, meal_count: mealCount },
    };
  }

  async reorderPlanMeals(userId: string, planId: string, input: ReorderMealsInput, lang?: string) {
    const coachId = await this.getCoachProfileId(userId);
    await this.getOwnedPlan(coachId, planId);

    const ids = input.meal_orders.map((m) => m.meal_id);

    const allMeals = await this.prisma.nutrition_meals.findMany({
      where: { nutrition_plan_id: planId },
      select: { id: true },
    });
    if (allMeals.length !== ids.length) throw new ServiceError("meal_orders_incomplete", 400);

    const existing = await this.prisma.nutrition_meals.findMany({
      where: { id: { in: ids }, nutrition_plan_id: planId },
      select: { id: true },
    });
    if (existing.length !== ids.length) throw new ServiceError("meal_not_found", 404);

    // Two-phase write: park every meal at a unique negative sentinel first, then
    // apply the final permutation — a direct swap would transiently duplicate
    // meal_order values and violate the DB unique constraint.
    try {
      await this.prisma.$transaction([
        ...input.meal_orders.map((m, i) =>
          this.prisma.nutrition_meals.update({
            where: { id: m.meal_id },
            data: { meal_order: -(i + 1) },
          })
        ),
        ...input.meal_orders.map((m) =>
          this.prisma.nutrition_meals.update({
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

    const meals = await this.prisma.nutrition_meals.findMany({
      where: { nutrition_plan_id: planId },
      orderBy: { meal_order: "asc" },
      include: { nutrition_meal_foods: { include: { food: true } } },
    });
    return { meals: meals.map((m) => this.toPlanMealResponse(m, lang)) };
  }

  // ==========================================================================
  // Plan Meal Food CRUD (US8)
  // ==========================================================================

  async addFoodToPlanMeal(
    userId: string,
    planId: string,
    mealId: string,
    input: CreateTemplateFoodInput,
    lang?: string
  ) {
    const coachId = await this.getCoachProfileId(userId);
    await this.getOwnedPlan(coachId, planId);
    await this.getOwnedPlanMeal(planId, mealId);

    const foodExists = await this.prisma.foods.findUnique({ where: { id: input.food_id } });
    if (!foodExists) throw new ServiceError("food_not_found", 404);
    if (foodExists.is_archived) throw new ServiceError("food_archived", 400);

    const existing = await this.prisma.nutrition_meal_foods.findFirst({
      where: { nutrition_meal_id: mealId, food_id: input.food_id },
    });
    if (existing) throw new ServiceError("food_already_in_meal", 400);

    let food: Prisma.nutrition_meal_foodsGetPayload<{ include: { food: true } }>;
    try {
      food = await this.prisma.nutrition_meal_foods.create({
        data: {
          nutrition_meal_id: mealId,
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
    const foodCount = await this.prisma.nutrition_meal_foods.count({
      where: { nutrition_meal_id: mealId },
    });
    return {
      food: toFoodPayload(food, lang),
      meal: { id: mealId, food_count: foodCount },
    };
  }

  async updatePlanFood(
    userId: string,
    planId: string,
    mealId: string,
    foodId: string,
    input: UpdateTemplateFoodInput,
    lang?: string
  ) {
    const coachId = await this.getCoachProfileId(userId);
    await this.getOwnedPlan(coachId, planId);
    await this.getOwnedPlanMeal(planId, mealId);
    await this.getOwnedPlanMealFood(mealId, foodId);

    const food = await this.prisma.nutrition_meal_foods.update({
      where: { id: foodId },
      data: { quantity: input.quantity },
      include: { food: true },
    });
    return { food: toFoodPayload(food, lang) };
  }

  async removeFoodFromPlanMeal(
    userId: string,
    planId: string,
    mealId: string,
    foodId: string
  ) {
    const coachId = await this.getCoachProfileId(userId);
    await this.getOwnedPlan(coachId, planId);
    await this.getOwnedPlanMeal(planId, mealId);
    await this.getOwnedPlanMealFood(mealId, foodId);

    await this.prisma.nutrition_meal_foods.delete({ where: { id: foodId } });
    const foodCount = await this.prisma.nutrition_meal_foods.count({
      where: { nutrition_meal_id: mealId },
    });
    return { messageKey: "plan_food_deleted", meal: { id: mealId, food_count: foodCount } };
  }
}
