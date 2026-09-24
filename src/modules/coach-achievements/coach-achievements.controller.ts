import { Request, Response } from "express";
import { injectable, inject } from "tsyringe";
import { CoachAchievementsService } from "./coach-achievements.service";
import { ServiceError } from "../../lib/service-error";
import * as validation from "./coach-achievements.validation";

@injectable()
export class CoachAchievementsController {
  constructor(@inject(CoachAchievementsService) private service: CoachAchievementsService) {}

  private handleError(req: Request, res: Response, err: unknown) {
    if (err instanceof ServiceError) {
      res.status(err.statusCode).json({ error: req.t(err.messageKey) });
      return;
    }
    console.error("unexpected error:", err);
    res.status(500).json({ error: req.t("internal_server_error") });
  }

  upload = async (req: Request, res: Response) => {
    try {
      const titleErr = validation.validateTitle(req.body?.title);
      if (titleErr) {
        res.status(400).json({ error: req.t(titleErr) });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: req.t("pdf_required") });
        return;
      }
      const userId = req.user!.sub;
      const result = await this.service.uploadAchievement(userId, req.body.title as string, req.file);
      res.status(201).json(result);
    } catch (err) {
      this.handleError(req, res, err);
    }
  };

  listMine = async (req: Request, res: Response) => {
    try {
      const userId = req.user!.sub;
      const achievements = await this.service.listMyAchievements(userId);
      res.status(200).json({ achievements });
    } catch (err) {
      this.handleError(req, res, err);
    }
  };

  delete = async (req: Request, res: Response) => {
    try {
      const rawId = req.params.id as unknown as string;
      const idErr = validation.validateAchievementId(rawId);
      if (idErr) {
        res.status(400).json({ error: req.t(idErr) });
        return;
      }
      const userId = req.user!.sub;
      const result = await this.service.deleteAchievement(userId, rawId);
      res.status(200).json({ message: req.t(result.message) });
    } catch (err) {
      this.handleError(req, res, err);
    }
  };

  listForClient = async (req: Request, res: Response) => {
    try {
      const userId = req.user!.sub;
      const achievements = await this.service.listCoachAchievementsForClient(userId);
      res.status(200).json({ achievements });
    } catch (err) {
      this.handleError(req, res, err);
    }
  };
}
