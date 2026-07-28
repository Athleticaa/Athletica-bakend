import { Router } from "express";
import { container } from "tsyringe";
import { ClientQuestionsController } from "./client-questions.controller";
import { authenticate, authorize } from "../../middleware/auth";

const router = Router();
const controller = container.resolve(ClientQuestionsController);

router.get("/questions", controller.getQuestions);
router.get("/answers", authenticate, authorize("client"), controller.getAnswers);
router.post("/answers", authenticate, authorize("client"), controller.createAnswers);
router.patch("/answers", authenticate, authorize("client"), controller.updateAnswers);

export default router;
