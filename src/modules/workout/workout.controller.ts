import { Request, Response } from "express";
import { injectable, container } from "tsyringe";
import { WorkoutService } from "./workout.service";
import { ServiceError } from "../../lib/service-error";
import { parseListExercisesQuery } from "./workout.validation";

@injectable()
export class WorkoutController {
  private service: WorkoutService;

  constructor() {
    this.service = container.resolve(WorkoutService);
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

  listExercises = async (req: Request, res: Response) => {
    const { result, errors } = parseListExercisesQuery(req.query, req.t);
    if (!result) {
      res.status(400).json({ error: req.t("validation_failed"), details: errors });
      return;
    }

    try {
      const data = await this.service.listExercises(result);
      res.status(200).json(data);
    } catch (err) {
      this.handleError(res, err);
    }
  };

  getExercise = async (req: Request, res: Response) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const exercise = await this.service.getExercise(id);
      res.status(200).json({ exercise });
    } catch (err) {
      this.handleError(res, err);
    }
  };
}
