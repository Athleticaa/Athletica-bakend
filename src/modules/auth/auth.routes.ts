import { Router } from "express";
import { container } from "tsyringe";
import { AuthController } from "./auth.controller";
import { authenticate } from "../../middleware/auth";

const router = Router();
const controller = container.resolve(AuthController);

router.post("/signup", controller.signup);
router.post("/login", controller.login);
router.post("/reset-password", controller.resetPassword);
router.post("/reset-password/confirm", controller.confirmReset);
router.post("/verify-email", controller.verifyEmail);
router.post("/resend-verification", controller.resendVerification);
router.post("/change-password", authenticate, controller.changePassword);
router.get("/me", authenticate, controller.me);

export default router;
