import { Router } from "express";
import { container } from "tsyringe";
import multer from "multer";
import { CheckInController } from "./checkin.controller";
import { authenticate, authorize } from "../../middleware/auth";
import { ServiceError } from "../../lib/service-error";

const controller = container.resolve(CheckInController);

// Multer for multi-file image uploads in check-in submissions
// NOTE: field names are dynamic question UUIDs, so we cannot use upload.fields([...]).
// upload.any() accepts any field name; controller filters by UUID.
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024, files: 10 }, // 5 MB per file, max 10 files
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new ServiceError("invalid_file_type", 400));
    }
  },
});

// ── Coach routes — mounted at /api/v1/coach/checkin ───────────────────────────
export const coachCheckInRouter = Router();

// Note: reorder must be registered BEFORE /:id so "reorder" is not matched as a UUID param
coachCheckInRouter.get(   "/questions",                                     authenticate, authorize("coach"), controller.getMyQuestions);
coachCheckInRouter.post(  "/questions",                                     authenticate, authorize("coach"), controller.createQuestion);
coachCheckInRouter.patch( "/questions/reorder",                             authenticate, authorize("coach"), controller.reorderQuestions);
coachCheckInRouter.patch( "/questions/:id",                                 authenticate, authorize("coach"), controller.updateQuestion);
coachCheckInRouter.delete("/questions/:id",                                 authenticate, authorize("coach"), controller.deleteQuestion);
coachCheckInRouter.post(  "/assign",                                        authenticate, authorize("coach"), controller.assignCheckIn);
coachCheckInRouter.get(   "/clients/:coachClientId/status",                      authenticate, authorize("coach"), controller.getClientCheckinStatus);
coachCheckInRouter.get(   "/clients/:coachClientId/submissions",                 authenticate, authorize("coach"), controller.getClientSubmissions);
coachCheckInRouter.get(   "/clients/:coachClientId/submissions/:submissionId",   authenticate, authorize("coach"), controller.getSubmissionDetail);

// ── Client routes — mounted at /api/v1/client/checkin ────────────────────────
export const clientCheckInRouter = Router();

clientCheckInRouter.get( "/questions",                    authenticate, authorize("client"), controller.getCoachQuestions);
clientCheckInRouter.post("/submit",                       authenticate, authorize("client"), upload.any(), controller.submitCheckIn);
clientCheckInRouter.get( "/hasassign",                    authenticate, authorize("client"), controller.hasPendingAssignment);
clientCheckInRouter.get( "/submissions",                  authenticate, authorize("client"), controller.getMySubmissions);
clientCheckInRouter.get( "/submissions/:submissionId",    authenticate, authorize("client"), controller.getMySubmissionDetail);
