import { Router } from "express";
import { container } from "tsyringe";
import { NotificationsController } from "./notifications.controller";
import { authenticate, authorize } from "../../middleware/auth";

const router = Router();
const controller = container.resolve(NotificationsController);

// Static routes are declared before :id so /unread-count and /read-all
// are never captured as an id param.
router.get("/", authenticate, authorize("coach", "client"), controller.list);
router.get("/unread-count", authenticate, authorize("coach", "client"), controller.unreadCount);
router.patch("/read-all", authenticate, authorize("coach", "client"), controller.markAllRead);
router.patch("/:id/read", authenticate, authorize("coach", "client"), controller.markRead);

export default router;
