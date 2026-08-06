import { Router } from "express";
import { container } from "tsyringe";
import { WorkoutController } from "./workout.controller";

const router = Router();
const controller = container.resolve(WorkoutController);

router.get("/exercises", controller.listExercises);
router.get("/exercises/:id", controller.getExercise);

export default router;
