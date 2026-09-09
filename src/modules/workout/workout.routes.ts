import { Router } from "express";
import { container } from "tsyringe";
import { authenticate, authorize } from "../../middleware/auth";
import { WorkoutController } from "./workout.controller";

const router = Router();
const controller = container.resolve(WorkoutController);

// Exercise Catalog (any authenticated user)
router.get("/exercises", authenticate, controller.listExercises);
router.get("/exercises/:id", authenticate, controller.getExercise);

// Template CRUD (US1) - Coach only
router.post("/templates", authenticate, authorize("coach"), controller.createTemplate);
router.get("/templates", authenticate, authorize("coach"), controller.listTemplates);
router.get("/templates/:id", authenticate, authorize("coach"), controller.getTemplate);
router.put("/templates/:id", authenticate, authorize("coach"), controller.updateTemplate);
router.delete("/templates/:id", authenticate, authorize("coach"), controller.deleteTemplate);

// Plan Assignment (US3) - Coach only
router.post("/templates/:tid/assign", authenticate, authorize("coach"), controller.assignPlan);

// Template Day Management (US1) - Coach only
router.post("/templates/:tid/days", authenticate, authorize("coach"), controller.addDayToTemplate);
router.put("/templates/:tid/days/reorder", authenticate, authorize("coach"), controller.reorderTemplateDays);
router.put("/templates/:tid/days/:did", authenticate, authorize("coach"), controller.updateTemplateDay);
router.delete("/templates/:tid/days/:did", authenticate, authorize("coach"), controller.deleteTemplateDay);

// Template Exercise Management (US1) - Coach only
router.post("/templates/:tid/days/:did/exercises", authenticate, authorize("coach"), controller.addExerciseToTemplateDay);
router.put("/templates/:tid/days/:did/exercises/:eid", authenticate, authorize("coach"), controller.updateTemplateDayExercise);
router.delete("/templates/:tid/days/:did/exercises/:eid", authenticate, authorize("coach"), controller.removeExerciseFromTemplateDay);

// Plan Day Management (US5) - Coach only
router.post("/plans/:pid/days", authenticate, authorize("coach"), controller.addDayToPlan);
router.put("/plans/:pid/days/reorder", authenticate, authorize("coach"), controller.reorderPlanDays);
router.put("/plans/:pid/days/:did", authenticate, authorize("coach"), controller.updatePlanDay);
router.delete("/plans/:pid/days/:did", authenticate, authorize("coach"), controller.deletePlanDay);

// Plan Exercise Management (US4) - Coach only
router.post("/plans/:pid/days/:did/exercises", authenticate, authorize("coach"), controller.addExerciseToPlanDay);
router.put("/plans/:pid/days/:did/exercises/:eid", authenticate, authorize("coach"), controller.updatePlanDayExercise);
router.delete("/plans/:pid/days/:did/exercises/:eid", authenticate, authorize("coach"), controller.removeExerciseFromPlanDay);

// Plan Listing & View (US6) - Coach only
router.get("/plans", authenticate, authorize("coach"), controller.listClientPlans);
router.get("/plans/:pid", authenticate, authorize("coach"), controller.getClientPlan);
router.put("/plans/:pid", authenticate, authorize("coach"), controller.updatePlan);
router.delete("/plans/:pid", authenticate, authorize("coach"), controller.deletePlan);

// Client Endpoints (US7) - Client only
router.get("/today", authenticate, authorize("client"), controller.getTodayWorkout);
router.get("/my/plans", authenticate, authorize("client"), controller.getMyActivePlan);
router.get("/my/plans/:pid", authenticate, authorize("client"), controller.getPlanDetails);

// Client Exercise Complete/Uncomplete (per-exercise, like nutrition meals) - Client only
router.post("/exercises/:elid/complete", authenticate, authorize("client"), controller.completeExercise);
router.post("/exercises/:elid/uncomplete", authenticate, authorize("client"), controller.uncompleteExercise);

// Client History (US9) - Client only
router.get("/history", authenticate, authorize("client"), controller.getHistory);

export default router;
