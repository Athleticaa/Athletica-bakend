import { Router } from "express";
import { container } from "tsyringe";
import { CoachAssignmentController } from "./coach-assignment.controller";
import { authenticate, authorize } from "../../middleware/auth";

const controller = container.resolve(CoachAssignmentController);

// Coach routes — mounted at /api/v1/coach
export const coachRouter = Router();

coachRouter.post("/invite", authenticate, authorize("coach"), controller.createInvite);
coachRouter.delete("/invite", authenticate, authorize("coach"), controller.revokeInvite);
coachRouter.get("/requests", authenticate, authorize("coach"), controller.listRequests);
coachRouter.post("/requests/:id/accept", authenticate, authorize("coach"), controller.acceptRequest);
coachRouter.post("/requests/:id/reject", authenticate, authorize("coach"), controller.rejectRequest);
coachRouter.get("/clients", authenticate, authorize("coach"), controller.listClients);
coachRouter.delete("/clients/:id", authenticate, authorize("coach"), controller.removeClient);

// Client routes — mounted at /api/v1/client
export const clientCoachRouter = Router();

clientCoachRouter.get("/coach", authenticate, authorize("client"), controller.getMyCoach);
clientCoachRouter.post("/leave-coach", authenticate, authorize("client"), controller.leaveCoach);

// Shared routes — mounted at /api/v1
export const requestsRouter = Router();

requestsRouter.post("/coach-requests", authenticate, authorize("client"), controller.submitRequest);
