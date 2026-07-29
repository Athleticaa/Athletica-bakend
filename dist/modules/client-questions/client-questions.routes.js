"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const tsyringe_1 = require("tsyringe");
const client_questions_controller_1 = require("./client-questions.controller");
const auth_1 = require("../../middleware/auth");
const router = (0, express_1.Router)();
const controller = tsyringe_1.container.resolve(client_questions_controller_1.ClientQuestionsController);
router.get("/questions", controller.getQuestions);
router.get("/answers", auth_1.authenticate, (0, auth_1.authorize)("client"), controller.getAnswers);
router.post("/answers", auth_1.authenticate, (0, auth_1.authorize)("client"), controller.createAnswers);
router.patch("/answers", auth_1.authenticate, (0, auth_1.authorize)("client"), controller.updateAnswers);
exports.default = router;
//# sourceMappingURL=client-questions.routes.js.map