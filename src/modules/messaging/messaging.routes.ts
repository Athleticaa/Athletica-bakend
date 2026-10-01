import { Router } from "express";
import { container } from "tsyringe";
import multer from "multer";
import { MessagingController } from "./messaging.controller";
import { authenticate, authorize } from "../../middleware/auth";
import { ServiceError } from "../../lib/service-error";
import { config } from "../../config";

const router = Router();
const controller = container.resolve(MessagingController);

// Media messaging (009-message-media): single-file uploads for images + voice.
// Memory ceiling sits above both per-type caps so rejections carry the
// specific validation key (image_too_large / voice_too_large); anything past
// the ceiling falls back to the global MulterError handler (file_too_large).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.messaging.uploadMaxBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    const allowed = [...config.messaging.allowedImageMimes, ...config.messaging.allowedVoiceMimes];
    if (allowed.some((m) => m === file.mimetype)) {
      cb(null, true);
    } else {
      cb(new ServiceError("message_invalid_file_type", 400, ["message_invalid_file_type"]));
    }
  },
});

// Both coach and client share conversation endpoints; role rules live in the service.
router.get("/conversations", authenticate, authorize("coach", "client"), controller.listConversations);
// Coach or client lazy-create / first message must be declared BEFORE :conversationId routes.
// Canonical: keyed by coach_clients.id (assignment row). Caller must own the assignment
// (coach via coach_id, client via client_id), else 403.
router.post(
  "/conversations/by-coach-client/:coachClientId/messages",
  authenticate,
  authorize("coach", "client"),
  upload.single("file"),
  controller.sendByCoachClientId,
);
// Deprecated alias: keyed by client_profiles.id. Kept for backward compat.
router.post(
  "/conversations/by-client/:clientId/messages",
  authenticate,
  authorize("coach"),
  upload.single("file"),
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
  upload.single("file"),
  controller.sendToConversation,
);
router.get(
  "/conversations/:conversationId/messages",
  authenticate,
  authorize("coach", "client"),
  controller.getHistory,
);

export default router;
