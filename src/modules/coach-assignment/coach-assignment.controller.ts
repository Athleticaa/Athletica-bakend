import { Request, Response } from "express";
import { injectable, container } from "tsyringe";
import { CoachAssignmentService, ServiceError } from "./coach-assignment.service";
import { validateSubmitRequest, isValidUuid } from "./coach-assignment.validation";

const APP_URL = process.env.APP_URL || "http://localhost:3000";

function mapClientProfile(client: any) {
  return {
    id: client.id,
    user: client.user,
    goal: client.goal,
    height: client.height,
    weight: client.weight,
  };
}

function mapRequestRecord(record: any) {
  return {
    id: record.id,
    coach_id: record.coach_id,
    client_id: record.client_id,
    status: record.status,
    created_at: record.created_at,
    updated_at: record.updated_at,
    rejected_at: record.rejected_at,
  };
}

@injectable()
export class CoachAssignmentController {
  private service: CoachAssignmentService;

  constructor() {
    this.service = container.resolve(CoachAssignmentService);
  }

  private handleError(res: Response, err: unknown) {
    if (err instanceof ServiceError) {
      const t = (res.req as Request).t || ((s: string) => s);
      res.status(err.statusCode).json({ error: t(err.messageKey) });
      return;
    }
    console.error("unexpected error:", err);
    const t = (res.req as Request).t || ((s: string) => s);
    res.status(500).json({ error: t("internal_server_error") });
  }

  createInvite = async (req: Request, res: Response) => {
    try {
      const { token, expires_at, reused } = await this.service.generateInvite(req.user!.sub);
      res.status(reused ? 200 : 201).json({
        token,
        invite_url: `${APP_URL}/invite/${token}`,
        expires_at,
      });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  revokeInvite = async (req: Request, res: Response) => {
    try {
      await this.service.revokeInvite(req.user!.sub);
      res.status(200).json({ message: req.t("invitation_revoked") });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  submitRequest = async (req: Request, res: Response) => {
    const errors = validateSubmitRequest(req.body, req.t);
    if (errors.length > 0) {
      res.status(400).json({ error: req.t("validation_failed"), details: errors });
      return;
    }

    try {
      const { record, created } = await this.service.submitRequest(req.user!.sub, req.body.token);
      res.status(created ? 201 : 200).json(mapRequestRecord(record));
    } catch (err) {
      this.handleError(res, err);
    }
  };

  listRequests = async (req: Request, res: Response) => {
    try {
      const { requests } = await this.service.listRequests(req.user!.sub);
      res.status(200).json({
        requests: requests.map((r: any) => ({
          id: r.id,
          client: {
            id: r.client.id,
            user: r.client.user,
            goal: r.client.goal,
          },
          status: r.status,
          created_at: r.created_at,
          rejected_at: r.rejected_at,
        })),
      });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  acceptRequest = async (req: Request, res: Response) => {
    const requestId = String(req.params.id);
    if (!isValidUuid(requestId)) {
      res.status(400).json({ error: req.t("validation_failed") });
      return;
    }

    try {
      const { request, assignment } = await this.service.acceptRequest(req.user!.sub, requestId);
      res.status(200).json({
        request: {
          id: request.id,
          status: request.status,
          updated_at: request.updated_at,
        },
        assignment: {
          id: assignment.id,
          coach_id: assignment.coach_id,
          client_id: assignment.client_id,
          created_at: assignment.created_at,
        },
      });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  rejectRequest = async (req: Request, res: Response) => {
    const requestId = String(req.params.id);
    if (!isValidUuid(requestId)) {
      res.status(400).json({ error: req.t("validation_failed") });
      return;
    }

    try {
      const record = await this.service.rejectRequest(req.user!.sub, requestId);
      res.status(200).json({
        id: record.id,
        status: record.status,
        updated_at: record.updated_at,
      });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  listClients = async (req: Request, res: Response) => {
    try {
      const { clients } = await this.service.listClients(req.user!.sub);
      res.status(200).json({
        clients: clients.map((c: any) => ({
          id: c.id,
          client: mapClientProfile(c.client),
          assigned_at: c.created_at,
        })),
      });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  getMyCoach = async (req: Request, res: Response) => {
    try {
      const { coach, assigned_at } = await this.service.getMyCoach(req.user!.sub);
      res.status(200).json({
        coach: {
          id: coach.id,
          user: coach.user,
          bio: coach.bio,
          specialization: coach.specialization,
        },
        assigned_at,
      });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  leaveCoach = async (req: Request, res: Response) => {
    try {
      await this.service.leaveCoach(req.user!.sub);
      res.status(200).json({ message: req.t("left_coach") });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  removeClient = async (req: Request, res: Response) => {
    const clientId = String(req.params.id);
    if (!isValidUuid(clientId)) {
      res.status(400).json({ error: req.t("validation_failed") });
      return;
    }

    try {
      await this.service.removeClient(req.user!.sub, clientId);
      res.status(200).json({ message: req.t("client_removed") });
    } catch (err) {
      this.handleError(res, err);
    }
  };
}
