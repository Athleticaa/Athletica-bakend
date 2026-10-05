import { Router } from "express";
import { container } from "tsyringe";
import { DevicesController } from "./devices.controller";
import { authenticate, authorize } from "../../middleware/auth";

const router = Router();
const controller = container.resolve(DevicesController);

router.post("/", authenticate, authorize("coach", "client"), controller.register);
router.delete("/", authenticate, authorize("coach", "client"), controller.unregister);
router.post("/heartbeat", authenticate, authorize("coach", "client"), controller.heartbeat);

export default router;
