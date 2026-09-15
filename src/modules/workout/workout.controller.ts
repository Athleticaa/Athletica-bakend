import { Request, Response } from "express";
import { injectable, container } from "tsyringe";
import { WorkoutService } from "./workout.service";
import { WorkoutTemplateService } from "./workout-template.service";
import { WorkoutPlanService } from "./workout-plan.service";
import { WorkoutClientService } from "./workout-client.service";
import { ServiceError } from "../../lib/service-error";
import { isValidUuid, parseListExercisesQuery, validateCreateTemplate, validateUpdateTemplate, validateCreateDay, validateUpdateDay, validateReorderDays, validateCreateTemplateExercise, validateUpdateTemplateExercise, validateAssignPlan, validateCreatePlanExercise, validateUpdatePlanExercise, validateUpdatePlan } from "./workout.validation";

@injectable()
export class WorkoutController {
  private exerciseService: WorkoutService;
  private templateService: WorkoutTemplateService;
  private planService: WorkoutPlanService;
  private clientService: WorkoutClientService;

  constructor() {
    this.exerciseService = container.resolve(WorkoutService);
    this.templateService = container.resolve(WorkoutTemplateService);
    this.planService = container.resolve(WorkoutPlanService);
    this.clientService = container.resolve(WorkoutClientService);
  }

  private userId(req: Request): string {
    if (!req.user) throw new ServiceError("auth_required", 401);
    return req.user.sub;
  }

  private param(req: Request, name: string): string {
    const raw = Array.isArray(req.params[name]) ? req.params[name][0] : req.params[name];
    if (!isValidUuid(raw)) throw new ServiceError("invalid_uuid", 400);
    return raw;
  }

  private handleError(res: Response, err: unknown) {
    if (err instanceof ServiceError) {
      const t = (res.req as Request).t || ((s: string) => s);
      res.status(err.statusCode).json({ success: false, error: t(err.messageKey) });
      return;
    }
    console.error("unexpected error:", err);
    const t = (res.req as Request).t || ((s: string) => s);
    res.status(500).json({ success: false, error: t("internal_server_error") });
  }

  // =========================================================================
  // Exercise Catalog
  // =========================================================================

  listExercises = async (req: Request, res: Response) => {
    const { result, errors } = parseListExercisesQuery(req.query, req.t);
    if (!result) {
      res.status(400).json({ success: false, error: req.t("validation_failed"), details: errors });
      return;
    }

    try {
      const data = await this.exerciseService.listExercises(result);
      res.status(200).json({ success: true, data });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  getExercise = async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id ?? "").trim();
      if (!id) throw new ServiceError("exercise_not_found", 404);
      const exercise = await this.exerciseService.getExercise(id);
      res.status(200).json({ success: true, data: { exercise } });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  // =========================================================================
  // Template CRUD (US1)
  // =========================================================================

  createTemplate = async (req: Request, res: Response) => {
    const errors = validateCreateTemplate(req.body, req.t);
    if (errors.length > 0) {
      res.status(400).json({ success: false, error: req.t("validation_failed"), details: errors });
      return;
    }

    try {
      const coachId = await this.templateService.getCoachIdFromUser(this.userId(req));
      const template = await this.templateService.createTemplate({
        title: req.body.title,
        description: req.body.description,
        coachId,
      });
      res.status(201).json({ success: true, data: template });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  listTemplates = async (req: Request, res: Response) => {
    try {
      const coachId = await this.templateService.getCoachIdFromUser(this.userId(req));
      const page = parseInt(req.query.page as string) || 1;
      const pageSize = parseInt(req.query.pageSize as string) || 10;

      if (page < 1 || pageSize < 1 || pageSize > 100) {
        res.status(400).json({ success: false, error: req.t("invalid_pagination") });
        return;
      }

      const data = await this.templateService.listTemplates({ coachId, page, pageSize });
      res.status(200).json({ success: true, data });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  getTemplate = async (req: Request, res: Response) => {
    try {
      const coachId = await this.templateService.getCoachIdFromUser(this.userId(req));
      const id = this.param(req, "id");
      const template = await this.templateService.getTemplate(id, coachId);
      res.status(200).json({ success: true, data: template });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  updateTemplate = async (req: Request, res: Response) => {
    const errors = validateUpdateTemplate(req.body, req.t);
    if (errors.length > 0) {
      res.status(400).json({ success: false, error: req.t("validation_failed"), details: errors });
      return;
    }

    try {
      const coachId = await this.templateService.getCoachIdFromUser(this.userId(req));
      const id = this.param(req, "id");
      const template = await this.templateService.updateTemplate(id, coachId, {
        title: req.body.title,
        description: req.body.description,
      });
      res.status(200).json({ success: true, data: template });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  deleteTemplate = async (req: Request, res: Response) => {
    try {
      const coachId = await this.templateService.getCoachIdFromUser(this.userId(req));
      const id = this.param(req, "id");
      const template = await this.templateService.deleteTemplate(id, coachId);
      res.status(200).json({ success: true, data: template });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  // =========================================================================
  // Template Day Management (US1)
  // =========================================================================

  addDayToTemplate = async (req: Request, res: Response) => {
    const errors = validateCreateDay(req.body, req.t);
    if (errors.length > 0) {
      res.status(400).json({ success: false, error: req.t("validation_failed"), details: errors });
      return;
    }

    try {
      const coachId = await this.templateService.getCoachIdFromUser(this.userId(req));
      const templateId = this.param(req, "tid");
      const template = await this.templateService.addDayToTemplate(templateId, coachId, {
        title: req.body.title,
        note: req.body.note,
      });
      res.status(201).json({ success: true, data: template });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  updateTemplateDay = async (req: Request, res: Response) => {
    const errors = validateUpdateDay(req.body, req.t);
    if (errors.length > 0) {
      res.status(400).json({ success: false, error: req.t("validation_failed"), details: errors });
      return;
    }

    try {
      const coachId = await this.templateService.getCoachIdFromUser(this.userId(req));
      const templateId = this.param(req, "tid");
      const dayId = this.param(req, "did");
      const template = await this.templateService.updateTemplateDay(templateId, coachId, dayId, {
        title: req.body.title,
        day_number: req.body.day_number,
        is_rest: req.body.is_rest,
        note: req.body.note,
      });
      res.status(200).json({ success: true, data: template });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  deleteTemplateDay = async (req: Request, res: Response) => {
    try {
      const coachId = await this.templateService.getCoachIdFromUser(this.userId(req));
      const templateId = this.param(req, "tid");
      const dayId = this.param(req, "did");
      const template = await this.templateService.deleteTemplateDay(templateId, coachId, dayId);
      res.status(200).json({ success: true, data: template });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  reorderTemplateDays = async (req: Request, res: Response) => {
    const errors = validateReorderDays(req.body, req.t);
    if (errors.length > 0) {
      res.status(400).json({ success: false, error: req.t("validation_failed"), details: errors });
      return;
    }

    try {
      const coachId = await this.templateService.getCoachIdFromUser(this.userId(req));
      const templateId = this.param(req, "tid");
      const template = await this.templateService.reorderTemplateDays(templateId, coachId, req.body.day_ids);
      res.status(200).json({ success: true, data: template });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  // =========================================================================
  // Template Exercise Management (US1)
  // =========================================================================

  addExerciseToTemplateDay = async (req: Request, res: Response) => {
    const errors = validateCreateTemplateExercise(req.body, req.t);
    if (errors.length > 0) {
      res.status(400).json({ success: false, error: req.t("validation_failed"), details: errors });
      return;
    }

    try {
      const coachId = await this.templateService.getCoachIdFromUser(this.userId(req));
      const templateId = this.param(req, "tid");
      const dayId = this.param(req, "did");
      const template = await this.templateService.addExerciseToTemplateDay(templateId, coachId, dayId, {
        exercise_id: req.body.exercise_id,
        exercise_order: req.body.exercise_order,
        notes: req.body.notes,
      });
      res.status(201).json({ success: true, data: template });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  updateTemplateDayExercise = async (req: Request, res: Response) => {
    const errors = validateUpdateTemplateExercise(req.body, req.t);
    if (errors.length > 0) {
      res.status(400).json({ success: false, error: req.t("validation_failed"), details: errors });
      return;
    }

    try {
      const coachId = await this.templateService.getCoachIdFromUser(this.userId(req));
      const templateId = this.param(req, "tid");
      const dayId = this.param(req, "did");
      const exerciseId = this.param(req, "eid");
      const template = await this.templateService.updateTemplateDayExercise(templateId, coachId, dayId, exerciseId, {
        exercise_order: req.body.exercise_order,
        notes: req.body.notes,
      });
      res.status(200).json({ success: true, data: template });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  removeExerciseFromTemplateDay = async (req: Request, res: Response) => {
    try {
      const coachId = await this.templateService.getCoachIdFromUser(this.userId(req));
      const templateId = this.param(req, "tid");
      const dayId = this.param(req, "did");
      const exerciseId = this.param(req, "eid");
      const template = await this.templateService.removeExerciseFromTemplateDay(templateId, coachId, dayId, exerciseId);
      res.status(200).json({ success: true, data: template });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  // =========================================================================
  // Plan Assignment (US3)
  // =========================================================================

  assignPlan = async (req: Request, res: Response) => {
    const errors = validateAssignPlan(req.body, req.t);
    if (errors.length > 0) {
      res.status(400).json({ success: false, error: req.t("validation_failed"), details: errors });
      return;
    }

    try {
      const coachId = await this.templateService.getCoachIdFromUser(this.userId(req));
      const templateId = this.param(req, "tid");
      const plan = await this.planService.assignPlan({
        coachId,
        coachClientId: req.body.coach_client_id,
        templateId,
        title: req.body.title,
        description: req.body.description,
      });
      res.status(201).json({ success: true, data: plan });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  // =========================================================================
  // Plan Day Management (US5)
  // =========================================================================

  addDayToPlan = async (req: Request, res: Response) => {
    const errors = validateCreateDay(req.body, req.t);
    if (errors.length > 0) {
      res.status(400).json({ success: false, error: req.t("validation_failed"), details: errors });
      return;
    }

    try {
      const coachId = await this.templateService.getCoachIdFromUser(this.userId(req));
      const planId = this.param(req, "pid");
      const plan = await this.planService.addDayToPlan(planId, coachId, {
        title: req.body.title,
        note: req.body.note,
      });
      res.status(201).json({ success: true, data: plan });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  updatePlanDay = async (req: Request, res: Response) => {
    const errors = validateUpdateDay(req.body, req.t);
    if (errors.length > 0) {
      res.status(400).json({ success: false, error: req.t("validation_failed"), details: errors });
      return;
    }

    try {
      const coachId = await this.templateService.getCoachIdFromUser(this.userId(req));
      const planId = this.param(req, "pid");
      const dayId = this.param(req, "did");
      const plan = await this.planService.updatePlanDay(planId, coachId, dayId, {
        title: req.body.title,
        day_number: req.body.day_number,
        is_rest: req.body.is_rest,
        note: req.body.note,
      });
      res.status(200).json({ success: true, data: plan });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  deletePlanDay = async (req: Request, res: Response) => {
    try {
      const coachId = await this.templateService.getCoachIdFromUser(this.userId(req));
      const planId = this.param(req, "pid");
      const dayId = this.param(req, "did");
      const plan = await this.planService.deletePlanDay(planId, coachId, dayId);
      res.status(200).json({ success: true, data: plan });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  reorderPlanDays = async (req: Request, res: Response) => {
    const errors = validateReorderDays(req.body, req.t);
    if (errors.length > 0) {
      res.status(400).json({ success: false, error: req.t("validation_failed"), details: errors });
      return;
    }

    try {
      const coachId = await this.templateService.getCoachIdFromUser(this.userId(req));
      const planId = this.param(req, "pid");
      const plan = await this.planService.reorderPlanDays(planId, coachId, req.body.day_ids);
      res.status(200).json({ success: true, data: plan });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  // =========================================================================
  // Plan Listing & View (US6)
  // =========================================================================

  listClientPlans = async (req: Request, res: Response) => {
    try {
      const coachId = await this.templateService.getCoachIdFromUser(this.userId(req));
      const page = parseInt(req.query.page as string) || 1;
      const pageSize = parseInt(req.query.pageSize as string) || 10;
      const clientId = req.query.client_id as string | undefined;
      const isActive = req.query.is_active !== undefined ? req.query.is_active === "true" : undefined;

      if (page < 1 || pageSize < 1 || pageSize > 100) {
        res.status(400).json({ success: false, error: req.t("invalid_pagination") });
        return;
      }

      const data = await this.planService.listClientPlans({ coachId, clientId, isActive, page, pageSize });
      res.status(200).json({ success: true, data });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  getClientPlan = async (req: Request, res: Response) => {
    try {
      const coachId = await this.templateService.getCoachIdFromUser(this.userId(req));
      const planId = this.param(req, "pid");
      const plan = await this.planService.getClientPlan(planId, coachId);
      res.status(200).json({ success: true, data: plan });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  updatePlan = async (req: Request, res: Response) => {
    const errors = validateUpdatePlan(req.body, req.t);
    if (errors.length > 0) {
      res.status(400).json({ success: false, error: req.t("validation_failed"), details: errors });
      return;
    }

    try {
      const coachId = await this.templateService.getCoachIdFromUser(this.userId(req));
      const planId = this.param(req, "pid");
      const plan = await this.planService.updatePlan(planId, coachId, {
        title: req.body.title,
        description: req.body.description,
      });
      res.status(200).json({ success: true, data: plan });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  deletePlan = async (req: Request, res: Response) => {
    try {
      const coachId = await this.templateService.getCoachIdFromUser(this.userId(req));
      const planId = this.param(req, "pid");
      const plan = await this.planService.deletePlan(planId, coachId);
      res.status(200).json({ success: true, data: plan });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  // =========================================================================
  // Plan Exercise Management (US4)
  // =========================================================================

  addExerciseToPlanDay = async (req: Request, res: Response) => {
    const errors = validateCreatePlanExercise(req.body, req.t);
    if (errors.length > 0) {
      res.status(400).json({ success: false, error: req.t("validation_failed"), details: errors });
      return;
    }

    try {
      const coachId = await this.templateService.getCoachIdFromUser(this.userId(req));
      const planId = this.param(req, "pid");
      const dayId = this.param(req, "did");
      const plan = await this.planService.addExerciseToPlanDay(planId, coachId, dayId, {
        exercise_id: req.body.exercise_id,
        order_number: req.body.order_number,
        sets: req.body.sets,
        reps: req.body.reps,
        rest_time: req.body.rest_time,
        notes: req.body.notes,
      });
      res.status(201).json({ success: true, data: plan });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  updatePlanDayExercise = async (req: Request, res: Response) => {
    const errors = validateUpdatePlanExercise(req.body, req.t);
    if (errors.length > 0) {
      res.status(400).json({ success: false, error: req.t("validation_failed"), details: errors });
      return;
    }

    try {
      const coachId = await this.templateService.getCoachIdFromUser(this.userId(req));
      const planId = this.param(req, "pid");
      const dayId = this.param(req, "did");
      const exerciseId = this.param(req, "eid");
      const plan = await this.planService.updatePlanDayExercise(planId, coachId, dayId, exerciseId, {
        order_number: req.body.order_number,
        sets: req.body.sets,
        reps: req.body.reps,
        rest_time: req.body.rest_time,
        notes: req.body.notes,
      });
      res.status(200).json({ success: true, data: plan });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  removeExerciseFromPlanDay = async (req: Request, res: Response) => {
    try {
      const coachId = await this.templateService.getCoachIdFromUser(this.userId(req));
      const planId = this.param(req, "pid");
      const dayId = this.param(req, "did");
      const exerciseId = this.param(req, "eid");
      const plan = await this.planService.removeExerciseFromPlanDay(planId, coachId, dayId, exerciseId);
      res.status(200).json({ success: true, data: plan });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  // =========================================================================
  // Client Endpoints (US7)
  // =========================================================================

  getTodayWorkout = async (req: Request, res: Response) => {
    try {
      const data = await this.clientService.getTodayWorkout(this.userId(req));
      res.status(200).json({ success: true, data });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  getMyActivePlan = async (req: Request, res: Response) => {
    try {
      const data = await this.clientService.getMyActivePlan(this.userId(req));
      res.status(200).json({ success: true, data });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  getPlanDetails = async (req: Request, res: Response) => {
    try {
      const planId = this.param(req, "pid");
      const data = await this.clientService.getPlanDetails(this.userId(req), planId);
      res.status(200).json({ success: true, data });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  // =========================================================================
  // Client Exercise Complete/Uncomplete (per-exercise, like nutrition meals)
  // =========================================================================

  completeExercise = async (req: Request, res: Response) => {
    try {
      const logId = this.param(req, "elid");
      const data = await this.clientService.completeExercise(this.userId(req), logId);
      res.status(200).json({ success: true, data });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  uncompleteExercise = async (req: Request, res: Response) => {
    try {
      const logId = this.param(req, "elid");
      const data = await this.clientService.uncompleteExercise(this.userId(req), logId);
      res.status(200).json({ success: true, data });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  // =========================================================================
  // Client History (US9)
  // =========================================================================

  getHistory = async (req: Request, res: Response) => {
    try {
      const data = await this.clientService.getHistory(this.userId(req));
      res.status(200).json({ success: true, data });
    } catch (err) {
      this.handleError(res, err);
    }
  };
}
