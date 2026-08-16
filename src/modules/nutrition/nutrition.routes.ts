import { Router } from "express";
import { container } from "tsyringe";
import { NutritionController } from "./nutrition.controller";
import { authenticate, authorize } from "../../middleware/auth";

const router = Router();
const controller = container.resolve(NutritionController);

router.get("/foods", authenticate, controller.listFoods);
router.get("/foods/:id", authenticate, controller.getFood);
router.get("/food-categories", authenticate, controller.listFoodCategories);

router.post("/templates", authenticate, authorize("coach"), controller.createTemplate);
router.get("/templates", authenticate, authorize("coach"), controller.listTemplates);
router.get("/templates/:id", authenticate, authorize("coach"), controller.getTemplate);
router.put("/templates/:id", authenticate, authorize("coach"), controller.updateTemplate);
router.delete("/templates/:id", authenticate, authorize("coach"), controller.deleteTemplate);

router.post("/templates/:tid/meals", authenticate, authorize("coach"), controller.addMeal);
// NOTE: literal "reorder" MUST be registered before :mid param or Express matches :mid="reorder"
router.put("/templates/:tid/meals/reorder", authenticate, authorize("coach"), controller.reorderMeals);
router.put("/templates/:tid/meals/:mid", authenticate, authorize("coach"), controller.updateMeal);
router.delete("/templates/:tid/meals/:mid", authenticate, authorize("coach"), controller.deleteMeal);

router.post("/templates/:tid/meals/:mid/foods", authenticate, authorize("coach"), controller.addFood);
router.put("/templates/:tid/meals/:mid/foods/:fid", authenticate, authorize("coach"), controller.updateFood);
router.delete("/templates/:tid/meals/:mid/foods/:fid", authenticate, authorize("coach"), controller.removeFood);

router.post("/templates/:tid/assign", authenticate, authorize("coach"), controller.assignPlan);
router.get("/plans", authenticate, authorize("coach"), controller.listClientPlans);
router.get("/plans/:pid", authenticate, authorize("coach"), controller.getClientPlan);
router.delete("/plans/:pid", authenticate, authorize("coach"), controller.deletePlan);

// Plan meals (US7) — literal "reorder" MUST be registered before :mid
router.post("/plans/:pid/meals", authenticate, authorize("coach"), controller.addPlanMeal);
router.put("/plans/:pid/meals/reorder", authenticate, authorize("coach"), controller.reorderPlanMeals);
router.put("/plans/:pid/meals/:mid", authenticate, authorize("coach"), controller.updatePlanMeal);
router.delete("/plans/:pid/meals/:mid", authenticate, authorize("coach"), controller.deletePlanMeal);

// Plan meal foods (US8)
router.post("/plans/:pid/meals/:mid/foods", authenticate, authorize("coach"), controller.addPlanFood);
router.put("/plans/:pid/meals/:mid/foods/:fid", authenticate, authorize("coach"), controller.updatePlanFood);
router.delete("/plans/:pid/meals/:mid/foods/:fid", authenticate, authorize("coach"), controller.removePlanFood);

router.get("/today", authenticate, authorize("client"), controller.getTodayMeals);
router.get("/my/plans", authenticate, authorize("client"), controller.getMyPlan);
router.get("/my/plans/:pid", authenticate, authorize("client"), controller.getPlanDetails);
router.post("/meals/:mlid/complete", authenticate, authorize("client"), controller.completeMeal);
router.post("/meals/:mlid/uncomplete", authenticate, authorize("client"), controller.uncompleteMeal);
router.get("/history", authenticate, authorize("client"), controller.getHistory);

export default router;
