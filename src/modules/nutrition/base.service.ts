import { PrismaClient } from "@prisma/client";
import { inject } from "tsyringe";
import { PrismaClientToken } from "../../di/tokens";
import { ServiceError } from "../../lib/service-error";

export abstract class NutritionBaseService {
  constructor(@inject(PrismaClientToken) protected prisma: PrismaClient) {}

  protected async getCoachProfileId(userId: string): Promise<string> {
    const profile = await this.prisma.coach_profiles.findFirst({ where: { user_id: userId } });
    if (!profile) throw new ServiceError("coach_profile_not_found", 404);
    return profile.id;
  }

  protected async getCoachClientId(coachId: string, coachClientId: string) {
    const cc = await this.prisma.coach_clients.findFirst({
      where: { id: coachClientId, coach_id: coachId },
    });
    if (!cc) throw new ServiceError("client_not_assigned_to_coach", 404);
    return cc;
  }

  protected async getOwnedTemplate(coachId: string, id: string) {
    const template = await this.prisma.nutrition_templates.findFirst({
      where: { id, coach_id: coachId, is_deleted: false },
      include: {
        nutrition_template_meals: {
          orderBy: { meal_order: "asc" },
          include: { nutrition_template_foods: true },
        },
      },
    });
    if (!template) throw new ServiceError("template_not_found", 404);
    return template;
  }

  protected async getOwnedTemplateWithCount(coachId: string, id: string) {
    const template = await this.prisma.nutrition_templates.findFirst({
      where: { id, coach_id: coachId, is_deleted: false },
      include: { _count: { select: { nutrition_template_meals: true } } },
    });
    if (!template) throw new ServiceError("template_not_found", 404);
    return template;
  }

  protected async getOwnedPlan(coachId: string, planId: string) {
    const plan = await this.prisma.nutrition_plans.findFirst({
      where: { id: planId, coach_client: { coach_id: coachId } },
    });
    if (!plan) throw new ServiceError("plan_not_found", 404);
    return plan;
  }

  protected async getOwnedPlanMeal(planId: string, mealId: string) {
    const meal = await this.prisma.nutrition_meals.findFirst({
      where: { id: mealId, nutrition_plan_id: planId },
    });
    if (!meal) throw new ServiceError("meal_not_found", 404);
    return meal;
  }

  protected async getOwnedPlanMealFood(mealId: string, foodId: string) {
    const food = await this.prisma.nutrition_meal_foods.findFirst({
      where: { id: foodId, nutrition_meal_id: mealId },
    });
    if (!food) throw new ServiceError("plan_food_not_found", 404);
    return food;
  }

  protected async getOwnedTemplateMeal(templateId: string, mealId: string) {
    const meal = await this.prisma.nutrition_template_meals.findFirst({
      where: { id: mealId, nutrition_template_id: templateId },
    });
    if (!meal) throw new ServiceError("meal_not_found", 404);
    return meal;
  }

  protected async getOwnedTemplateMealFood(templateId: string, mealId: string, foodId: string) {
    const food = await this.prisma.nutrition_template_foods.findFirst({
      where: { id: foodId, nutrition_template_meal_id: mealId },
    });
    if (!food) throw new ServiceError("template_food_not_found", 404);
    return food;
  }
}
