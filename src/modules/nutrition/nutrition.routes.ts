import { Router } from "express";
import { container } from "tsyringe";
import { NutritionController } from "./nutrition.controller";

const router = Router();
const controller = container.resolve(NutritionController);

router.get("/foods", controller.listFoods);
router.get("/foods/:id", controller.getFood);
router.get("/food-categories", controller.listFoodCategories);

export default router;
