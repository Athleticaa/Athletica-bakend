import { Router } from "express";
import { container } from "tsyringe";
import { CoachAssignmentController } from "./coach-assignment.controller";
import { authenticate, authorize } from "../../middleware/auth";

const router = Router();
const controller = container.resolve(CoachAssignmentController);

router.post("/coach/invite", authenticate, authorize("coach"), controller.createInvite);
router.delete("/coach/invite", authenticate, authorize("coach"), controller.revokeInvite);
router.post("/coach-requests", authenticate, authorize("client"), controller.submitRequest);
router.get("/coach/requests", authenticate, authorize("coach"), controller.listRequests);
router.post("/coach-requests/:id/accept", authenticate, authorize("coach"), controller.acceptRequest);
router.post("/coach-requests/:id/reject", authenticate, authorize("coach"), controller.rejectRequest);
router.get("/coach/clients", authenticate, authorize("coach"), controller.listClients);
router.get("/client/coach", authenticate, authorize("client"), controller.getMyCoach);
router.post("/client/leave-coach", authenticate, authorize("client"), controller.leaveCoach);
router.delete("/coach/clients/:id", authenticate, authorize("coach"), controller.removeClient);

export default router;
