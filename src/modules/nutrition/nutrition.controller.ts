import { Request, Response } from "express";
import { injectable, inject } from "tsyringe";
import { Prisma } from "@prisma/client";
import { IFoodService, FoodService } from "./food.service";
import { INutritionTemplateService, NutritionTemplateService } from "./nutrition-template.service";
import { INutritionPlanService, NutritionPlanService } from "./nutrition-plan.service";
import { INutritionClientService, NutritionClientService } from "./nutrition-client.service";
import { addDays, formatDateOnly, todayDateOnly } from "./nutrition.utils";
import { ServiceError } from "../../lib/service-error";
import {
  parseListFoodsQuery,
  validateCreateTemplate,
  validateUpdateTemplate,
  validateCreateMeal,
  validateUpdateMeal,
  validateReorderMeals,
  validateCreateTemplateFood,
  validateUpdateTemplateFood,
  validateAssignPlan,
  validateHistoryQuery,
  parseListClientPlansQuery,
  parsePaginatedQuery,
  isValidUuid,
  type CreateTemplateInput,
  type UpdateTemplateInput,
  type CreateMealInput,
  type UpdateMealInput,
  type ReorderMealsInput,
  type CreateTemplateFoodInput,
  type UpdateTemplateFoodInput,
  type AssignPlanInput,
  type HistoryQuery,
} from "./nutrition.validation";

@injectable()
export class NutritionController {
  constructor(
    @inject(FoodService) private foodService: IFoodService,
    @inject(NutritionTemplateService) private templateService: INutritionTemplateService,
    @inject(NutritionPlanService) private planService: INutritionPlanService,
    @inject(NutritionClientService) private clientService: INutritionClientService,
  ) {}

  private handleError(res: Response, err: unknown) {
    if (err instanceof ServiceError) {
      const t = (res.req as Request).t || ((s: string) => s);
      res.status(err.statusCode).json({ error: t(err.messageKey) });
      return;
    }
    const t = (res.req as Request).t || ((s: string) => s);
    // A row deleted between the pre-fetch check and the write (P2025) surfaces
    // as a race — treat it as not found instead of a 500.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      res.status(404).json({ error: t("record_not_found") });
      return;
    }
    console.error("unexpected error:", err);
    res.status(500).json({ error: t("internal_server_error") });
  }

  private userId(req: Request): string {
    if (!req.user) throw new ServiceError("auth_required", 401);
    return req.user.sub;
  }

  // ==========================================================================
  // Food handlers
  // ==========================================================================

  listFoods = async (req: Request, res: Response) => {
    const { result, errors } = parseListFoodsQuery(req.query, req.t);
    if (!result) {
      res.status(400).json({ error: req.t("validation_failed"), details: errors });
      return;
    }

    try {
      const data = await this.foodService.listFoods(result);
      res.status(200).json(data);
    } catch (err) {
      this.handleError(res, err);
    }
  };

  getFood = async (req: Request, res: Response) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!isValidUuid(id)) {
        res.status(400).json({ error: req.t("invalid_uuid") });
        return;
      }
      const food = await this.foodService.getFood(id);
      res.status(200).json({ food });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  listFoodCategories = async (_req: Request, res: Response) => {
    try {
      const categories = await this.foodService.listFoodCategories();
      res.status(200).json({ categories });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  // ==========================================================================
  // Template handlers (US1)
  // ==========================================================================

  createTemplate = async (req: Request, res: Response) => {
    const errors = validateCreateTemplate(req.body as CreateTemplateInput, req.t);
    if (errors.length > 0) {
      res.status(400).json({ error: req.t("validation_failed"), details: errors });
      return;
    }

    try {
      const template = await this.templateService.createTemplate(this.userId(req), req.body);
      res.status(201).json({ template });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  listTemplates = async (req: Request, res: Response) => {
    const { result, errors } = parsePaginatedQuery(req.query, req.t);
    if (!result) {
      res.status(400).json({ error: req.t("validation_failed"), details: errors });
      return;
    }

    try {
      const data = await this.templateService.listTemplates(this.userId(req), result);
      res.status(200).json(data);
    } catch (err) {
      this.handleError(res, err);
    }
  };

  getTemplate = async (req: Request, res: Response) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!isValidUuid(id)) {
        res.status(400).json({ error: req.t("invalid_uuid") });
        return;
      }
      const template = await this.templateService.getTemplate(this.userId(req), id, req.language);
      res.status(200).json({ template });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  updateTemplate = async (req: Request, res: Response) => {
    const errors = validateUpdateTemplate(req.body as UpdateTemplateInput, req.t);
    if (errors.length > 0) {
      res.status(400).json({ error: req.t("validation_failed"), details: errors });
      return;
    }

    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!isValidUuid(id)) {
        res.status(400).json({ error: req.t("invalid_uuid") });
        return;
      }
      const template = await this.templateService.updateTemplate(this.userId(req), id, req.body);
      res.status(200).json({ template });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  deleteTemplate = async (req: Request, res: Response) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!isValidUuid(id)) {
        res.status(400).json({ error: req.t("invalid_uuid") });
        return;
      }
      const result = await this.templateService.deleteTemplate(this.userId(req), id);
      res.status(200).json({ message: req.t(result.messageKey) });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  // ==========================================================================
  // Template Meal handlers (US2)
  // ==========================================================================

  addMeal = async (req: Request, res: Response) => {
    const errors = validateCreateMeal(req.body as CreateMealInput, req.t);
    if (errors.length > 0) {
      res.status(400).json({ error: req.t("validation_failed"), details: errors });
      return;
    }

    try {
      const templateId = Array.isArray(req.params.tid) ? req.params.tid[0] : req.params.tid;
      if (!isValidUuid(templateId)) {
        res.status(400).json({ error: req.t("invalid_uuid") });
        return;
      }
      const result = await this.templateService.addMealToTemplate(this.userId(req), templateId, req.body, req.language);
      res.status(201).json(result);
    } catch (err) {
      this.handleError(res, err);
    }
  };

  updateMeal = async (req: Request, res: Response) => {
    const errors = validateUpdateMeal(req.body as UpdateMealInput, req.t);
    if (errors.length > 0) {
      res.status(400).json({ error: req.t("validation_failed"), details: errors });
      return;
    }

    try {
      const templateId = Array.isArray(req.params.tid) ? req.params.tid[0] : req.params.tid;
      const mealId = Array.isArray(req.params.mid) ? req.params.mid[0] : req.params.mid;
      if (!isValidUuid(templateId) || !isValidUuid(mealId)) {
        res.status(400).json({ error: req.t("invalid_uuid") });
        return;
      }
      const result = await this.templateService.updateTemplateMeal(this.userId(req), templateId, mealId, req.body, req.language);
      res.status(200).json(result);
    } catch (err) {
      this.handleError(res, err);
    }
  };

  deleteMeal = async (req: Request, res: Response) => {
    try {
      const templateId = Array.isArray(req.params.tid) ? req.params.tid[0] : req.params.tid;
      const mealId = Array.isArray(req.params.mid) ? req.params.mid[0] : req.params.mid;
      if (!isValidUuid(templateId) || !isValidUuid(mealId)) {
        res.status(400).json({ error: req.t("invalid_uuid") });
        return;
      }
      const result = await this.templateService.deleteTemplateMeal(this.userId(req), templateId, mealId);
      res.status(200).json({
        message: req.t(result.messageKey),
        template: result.template,
      });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  reorderMeals = async (req: Request, res: Response) => {
    const errors = validateReorderMeals(req.body as ReorderMealsInput, req.t);
    if (errors.length > 0) {
      res.status(400).json({ error: req.t("validation_failed"), details: errors });
      return;
    }

    try {
      const templateId = Array.isArray(req.params.tid) ? req.params.tid[0] : req.params.tid;
      if (!isValidUuid(templateId)) {
        res.status(400).json({ error: req.t("invalid_uuid") });
        return;
      }
      const result = await this.templateService.reorderTemplateMeals(this.userId(req), templateId, req.body, req.language);
      res.status(200).json(result);
    } catch (err) {
      this.handleError(res, err);
    }
  };

  // ==========================================================================
  // Template Food handlers (US3)
  // ==========================================================================

  addFood = async (req: Request, res: Response) => {
    const errors = validateCreateTemplateFood(req.body as CreateTemplateFoodInput, req.t);
    if (errors.length > 0) {
      res.status(400).json({ error: req.t("validation_failed"), details: errors });
      return;
    }

    try {
      const templateId = Array.isArray(req.params.tid) ? req.params.tid[0] : req.params.tid;
      const mealId = Array.isArray(req.params.mid) ? req.params.mid[0] : req.params.mid;
      if (!isValidUuid(templateId) || !isValidUuid(mealId)) {
        res.status(400).json({ error: req.t("invalid_uuid") });
        return;
      }
      const result = await this.templateService.addFoodToTemplateMeal(this.userId(req), templateId, mealId, req.body, req.language);
      res.status(201).json(result);
    } catch (err) {
      this.handleError(res, err);
    }
  };

  updateFood = async (req: Request, res: Response) => {
    const errors = validateUpdateTemplateFood(req.body as UpdateTemplateFoodInput, req.t);
    if (errors.length > 0) {
      res.status(400).json({ error: req.t("validation_failed"), details: errors });
      return;
    }

    try {
      const templateId = Array.isArray(req.params.tid) ? req.params.tid[0] : req.params.tid;
      const mealId = Array.isArray(req.params.mid) ? req.params.mid[0] : req.params.mid;
      const foodId = Array.isArray(req.params.fid) ? req.params.fid[0] : req.params.fid;
      if (!isValidUuid(templateId) || !isValidUuid(mealId) || !isValidUuid(foodId)) {
        res.status(400).json({ error: req.t("invalid_uuid") });
        return;
      }
      const result = await this.templateService.updateTemplateFood(this.userId(req), templateId, mealId, foodId, req.body, req.language);
      res.status(200).json(result);
    } catch (err) {
      this.handleError(res, err);
    }
  };

  removeFood = async (req: Request, res: Response) => {
    try {
      const templateId = Array.isArray(req.params.tid) ? req.params.tid[0] : req.params.tid;
      const mealId = Array.isArray(req.params.mid) ? req.params.mid[0] : req.params.mid;
      const foodId = Array.isArray(req.params.fid) ? req.params.fid[0] : req.params.fid;
      if (!isValidUuid(templateId) || !isValidUuid(mealId) || !isValidUuid(foodId)) {
        res.status(400).json({ error: req.t("invalid_uuid") });
        return;
      }
      const result = await this.templateService.removeFoodFromTemplateMeal(this.userId(req), templateId, mealId, foodId);
      res.status(200).json({ message: req.t(result.messageKey), meal: result.meal });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  // ==========================================================================
  // Plan handlers (US4)
  // ==========================================================================

  assignPlan = async (req: Request, res: Response) => {
    const errors = validateAssignPlan(req.body as AssignPlanInput, req.t);
    if (errors.length > 0) {
      res.status(400).json({ error: req.t("validation_failed"), details: errors });
      return;
    }

    try {
      const templateId = Array.isArray(req.params.tid) ? req.params.tid[0] : req.params.tid;
      if (!isValidUuid(templateId)) {
        res.status(400).json({ error: req.t("invalid_uuid") });
        return;
      }
      const plan = await this.planService.createPlanFromTemplate(this.userId(req), templateId, req.body);
      res.status(201).json({ plan });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  listClientPlans = async (req: Request, res: Response) => {
    const { result, errors } = parseListClientPlansQuery(req.query, req.t);
    if (!result) {
      res.status(400).json({ error: req.t("validation_failed"), details: errors });
      return;
    }

    try {
      const data = await this.planService.listClientPlans(this.userId(req), result);
      res.status(200).json(data);
    } catch (err) {
      this.handleError(res, err);
    }
  };

  getClientPlan = async (req: Request, res: Response) => {
    try {
      const planId = Array.isArray(req.params.pid) ? req.params.pid[0] : req.params.pid;
      if (!isValidUuid(planId)) {
        res.status(400).json({ error: req.t("invalid_uuid") });
        return;
      }
      const plan = await this.planService.getClientPlan(this.userId(req), planId, req.language);
      res.status(200).json({ plan });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  deletePlan = async (req: Request, res: Response) => {
    try {
      const planId = Array.isArray(req.params.pid) ? req.params.pid[0] : req.params.pid;
      if (!isValidUuid(planId)) {
        res.status(400).json({ error: req.t("invalid_uuid") });
        return;
      }
      const result = await this.planService.deletePlan(this.userId(req), planId);
      res.status(200).json({ message: req.t(result.messageKey) });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  // ==========================================================================
  // Plan Meal handlers (US7)
  // ==========================================================================

  addPlanMeal = async (req: Request, res: Response) => {
    const errors = validateCreateMeal(req.body as CreateMealInput, req.t);
    if (errors.length > 0) {
      res.status(400).json({ error: req.t("validation_failed"), details: errors });
      return;
    }

    try {
      const planId = Array.isArray(req.params.pid) ? req.params.pid[0] : req.params.pid;
      if (!isValidUuid(planId)) {
        res.status(400).json({ error: req.t("invalid_uuid") });
        return;
      }
      const result = await this.planService.addMealToPlan(this.userId(req), planId, req.body, req.language);
      res.status(201).json(result);
    } catch (err) {
      this.handleError(res, err);
    }
  };

  updatePlanMeal = async (req: Request, res: Response) => {
    const errors = validateUpdateMeal(req.body as UpdateMealInput, req.t);
    if (errors.length > 0) {
      res.status(400).json({ error: req.t("validation_failed"), details: errors });
      return;
    }

    try {
      const planId = Array.isArray(req.params.pid) ? req.params.pid[0] : req.params.pid;
      const mealId = Array.isArray(req.params.mid) ? req.params.mid[0] : req.params.mid;
      if (!isValidUuid(planId) || !isValidUuid(mealId)) {
        res.status(400).json({ error: req.t("invalid_uuid") });
        return;
      }
      const result = await this.planService.updatePlanMeal(this.userId(req), planId, mealId, req.body, req.language);
      res.status(200).json(result);
    } catch (err) {
      this.handleError(res, err);
    }
  };

  deletePlanMeal = async (req: Request, res: Response) => {
    try {
      const planId = Array.isArray(req.params.pid) ? req.params.pid[0] : req.params.pid;
      const mealId = Array.isArray(req.params.mid) ? req.params.mid[0] : req.params.mid;
      if (!isValidUuid(planId) || !isValidUuid(mealId)) {
        res.status(400).json({ error: req.t("invalid_uuid") });
        return;
      }
      const result = await this.planService.deletePlanMeal(this.userId(req), planId, mealId);
      res.status(200).json({
        message: req.t(result.messageKey),
        plan: result.plan,
      });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  reorderPlanMeals = async (req: Request, res: Response) => {
    const errors = validateReorderMeals(req.body as ReorderMealsInput, req.t);
    if (errors.length > 0) {
      res.status(400).json({ error: req.t("validation_failed"), details: errors });
      return;
    }

    try {
      const planId = Array.isArray(req.params.pid) ? req.params.pid[0] : req.params.pid;
      if (!isValidUuid(planId)) {
        res.status(400).json({ error: req.t("invalid_uuid") });
        return;
      }
      const result = await this.planService.reorderPlanMeals(this.userId(req), planId, req.body, req.language);
      res.status(200).json(result);
    } catch (err) {
      this.handleError(res, err);
    }
  };

  // ==========================================================================
  // Plan Food handlers (US8)
  // ==========================================================================

  addPlanFood = async (req: Request, res: Response) => {
    const errors = validateCreateTemplateFood(req.body as CreateTemplateFoodInput, req.t);
    if (errors.length > 0) {
      res.status(400).json({ error: req.t("validation_failed"), details: errors });
      return;
    }

    try {
      const planId = Array.isArray(req.params.pid) ? req.params.pid[0] : req.params.pid;
      const mealId = Array.isArray(req.params.mid) ? req.params.mid[0] : req.params.mid;
      if (!isValidUuid(planId) || !isValidUuid(mealId)) {
        res.status(400).json({ error: req.t("invalid_uuid") });
        return;
      }
      const result = await this.planService.addFoodToPlanMeal(this.userId(req), planId, mealId, req.body, req.language);
      res.status(201).json(result);
    } catch (err) {
      this.handleError(res, err);
    }
  };

  updatePlanFood = async (req: Request, res: Response) => {
    const errors = validateUpdateTemplateFood(req.body as UpdateTemplateFoodInput, req.t);
    if (errors.length > 0) {
      res.status(400).json({ error: req.t("validation_failed"), details: errors });
      return;
    }

    try {
      const planId = Array.isArray(req.params.pid) ? req.params.pid[0] : req.params.pid;
      const mealId = Array.isArray(req.params.mid) ? req.params.mid[0] : req.params.mid;
      const foodId = Array.isArray(req.params.fid) ? req.params.fid[0] : req.params.fid;
      if (!isValidUuid(planId) || !isValidUuid(mealId) || !isValidUuid(foodId)) {
        res.status(400).json({ error: req.t("invalid_uuid") });
        return;
      }
      const result = await this.planService.updatePlanFood(this.userId(req), planId, mealId, foodId, req.body, req.language);
      res.status(200).json(result);
    } catch (err) {
      this.handleError(res, err);
    }
  };

  removePlanFood = async (req: Request, res: Response) => {
    try {
      const planId = Array.isArray(req.params.pid) ? req.params.pid[0] : req.params.pid;
      const mealId = Array.isArray(req.params.mid) ? req.params.mid[0] : req.params.mid;
      const foodId = Array.isArray(req.params.fid) ? req.params.fid[0] : req.params.fid;
      if (!isValidUuid(planId) || !isValidUuid(mealId) || !isValidUuid(foodId)) {
        res.status(400).json({ error: req.t("invalid_uuid") });
        return;
      }
      const result = await this.planService.removeFoodFromPlanMeal(this.userId(req), planId, mealId, foodId);
      res.status(200).json({ message: req.t(result.messageKey), meal: result.meal });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  // ==========================================================================
  // Client View handlers (US5/US6/US9)
  // ==========================================================================

  getTodayMeals = async (req: Request, res: Response) => {
    try {
      const data = await this.clientService.getTodayMeals(this.userId(req), req.language);
      res.status(200).json(data);
    } catch (err) {
      this.handleError(res, err);
    }
  };

  getMyPlan = async (req: Request, res: Response) => {
    try {
      const data = await this.clientService.getMyActivePlan(this.userId(req));
      res.status(200).json(data);
    } catch (err) {
      this.handleError(res, err);
    }
  };

  getPlanDetails = async (req: Request, res: Response) => {
    try {
      const planId = Array.isArray(req.params.pid) ? req.params.pid[0] : req.params.pid;
      if (!isValidUuid(planId)) {
        res.status(400).json({ error: req.t("invalid_uuid") });
        return;
      }
      const data = await this.clientService.getPlanDetails(this.userId(req), planId, req.language);
      res.status(200).json(data);
    } catch (err) {
      this.handleError(res, err);
    }
  };

  completeMeal = async (req: Request, res: Response) => {
    try {
      const mealLogId = Array.isArray(req.params.mlid) ? req.params.mlid[0] : req.params.mlid;
      if (!isValidUuid(mealLogId)) {
        res.status(400).json({ error: req.t("invalid_uuid") });
        return;
      }
      const result = await this.clientService.completeMeal(this.userId(req), mealLogId, req.language);
      res.status(200).json(result);
    } catch (err) {
      this.handleError(res, err);
    }
  };

  uncompleteMeal = async (req: Request, res: Response) => {
    try {
      const mealLogId = Array.isArray(req.params.mlid) ? req.params.mlid[0] : req.params.mlid;
      if (!isValidUuid(mealLogId)) {
        res.status(400).json({ error: req.t("invalid_uuid") });
        return;
      }
      const result = await this.clientService.uncompleteMeal(this.userId(req), mealLogId, req.language);
      res.status(200).json(result);
    } catch (err) {
      this.handleError(res, err);
    }
  };

  getHistory = async (req: Request, res: Response) => {
    const raw = req.query as unknown as Partial<HistoryQuery>;
    // Missing bounds default to the last 30 days (inclusive) ending today
    const today = todayDateOnly();
    const query: HistoryQuery = {
      from: typeof raw.from === "string" ? raw.from : formatDateOnly(addDays(today, -29)),
      to: typeof raw.to === "string" ? raw.to : formatDateOnly(today),
    };
    const errors = validateHistoryQuery(query, req.t);
    if (errors.length > 0) {
      res.status(400).json({ error: req.t("validation_failed"), details: errors });
      return;
    }

    try {
      const data = await this.clientService.getHistory(this.userId(req), query);
      res.status(200).json(data);
    } catch (err) {
      this.handleError(res, err);
    }
  };
}
