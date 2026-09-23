import { Router } from "express";
import { container } from "tsyringe";
import { MessagingController } from "./messaging.controller";
import { authenticate, authorize } from "../../middleware/auth";

const router = Router();
const controller = container.resolve(MessagingController);

// Both coach and client share conversation endpoints; role rules live in the service.
router.get("/conversations", authenticate, authorize("coach", "client"), controller.listConversations);
// Coach or client lazy-create / first message must be declared BEFORE :conversationId routes.
// Canonical: keyed by coach_clients.id (assignment row). Caller must own the assignment
// (coach via coach_id, client via client_id), else 403.
router.post(
  "/conversations/by-coach-client/:coachClientId/messages",
  authenticate,
  authorize("coach", "client"),
  controller.sendByCoachClientId,
);
// Deprecated alias: keyed by client_profiles.id. Kept for backward compat.
router.post(
  "/conversations/by-client/:clientId/messages",
  authenticate,
  authorize("coach"),
  controller.sendByClientId,
);
router.get(
  "/conversations/:conversationId",
  authenticate,
  authorize("coach", "client"),
  controller.getConversation,
);
router.post(
  "/conversations/:conversationId/messages",
  authenticate,
  authorize("coach", "client"),
  controller.sendToConversation,
);
router.get(
  "/conversations/:conversationId/messages",
  authenticate,
  authorize("coach", "client"),
  controller.getHistory,
);

export default router;
