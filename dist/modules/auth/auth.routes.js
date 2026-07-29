"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const tsyringe_1 = require("tsyringe");
const auth_controller_1 = require("./auth.controller");
const auth_1 = require("../../middleware/auth");
const router = (0, express_1.Router)();
const controller = tsyringe_1.container.resolve(auth_controller_1.AuthController);
router.post("/signup", controller.signup);
router.post("/login", controller.login);
router.post("/reset-password", controller.resetPassword);
router.post("/reset-password/confirm", controller.confirmReset);
router.post("/verify-email", controller.verifyEmail);
router.post("/resend-verification", controller.resendVerification);
router.post("/change-password", auth_1.authenticate, controller.changePassword);
router.get("/me", auth_1.authenticate, controller.me);
exports.default = router;
//# sourceMappingURL=auth.routes.js.map