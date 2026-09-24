import { Router } from "express";
import { container } from "tsyringe";
import multer from "multer";
import { CoachAchievementsController } from "./coach-achievements.controller";
import { authenticate, authorize } from "../../middleware/auth";
import { ServiceError } from "../../lib/service-error";

const controller = container.resolve(CoachAchievementsController);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf") {
      cb(null, true);
    } else {
      cb(new ServiceError("achievement_invalid_file_type", 400));
    }
  },
});

export const coachAchievementsRouter = Router();

coachAchievementsRouter.post(
  "/",
  authenticate,
  authorize("coach"),
  upload.single("pdf"),
  controller.upload,
);
coachAchievementsRouter.get("/", authenticate, authorize("coach"), controller.listMine);
coachAchievementsRouter.delete("/:id", authenticate, authorize("coach"), controller.delete);

export const clientAchievementsRouter = Router();

clientAchievementsRouter.get(
  "/",
  authenticate,
  authorize("client"),
  controller.listForClient,
);
