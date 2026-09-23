import { Router } from "express";
import { container } from "tsyringe";
import { RealtimeController } from "./realtime.controller";
import { authenticate, authorize } from "../../middleware/auth";

const router = Router();
const controller = container.resolve(RealtimeController);

// GET /api/v1/realtime/ably-token?conversationId=<uuid>
router.get("/ably-token", authenticate, authorize("coach", "client"), controller.getAblyToken);

export default router;
