import { Request, Response } from "express";
import { injectable, container } from "tsyringe";
import { ClientQuestionsService, ServiceError } from "./client-questions.service";
import * as validation from "./client-questions.validation";

@injectable()
export class ClientQuestionsController {
  private service: ClientQuestionsService;

  constructor() {
    this.service = container.resolve(ClientQuestionsService);
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

  getQuestions = async (req: Request, res: Response) => {
    try {
      const questions = await this.service.getQuestions(req.language);
      res.status(200).json({ questions });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  getAnswers = async (req: Request, res: Response) => {
    try {
      const clientId = await this.service.getClientProfileId(req.user!.sub);
      const answers = await this.service.getAnswers(clientId, req.language);
      res.status(200).json({ answers });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  createAnswers = async (req: Request, res: Response) => {
    const errors = validation.validateSubmitAnswers(req.body, req.t);
    if (errors.length > 0) {
      res.status(400).json({ error: req.t("validation_failed"), details: errors });
      return;
    }

    try {
      const clientId = await this.service.getClientProfileId(req.user!.sub);
      await this.service.createAnswers(clientId, req.body.answers);
      res.status(201).json({ message: req.t("answers_created") });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  updateAnswers = async (req: Request, res: Response) => {
    const errors = validation.validateUpdateAnswers(req.body, req.t);
    if (errors.length > 0) {
      res.status(400).json({ error: req.t("validation_failed"), details: errors });
      return;
    }

    try {
      const clientId = await this.service.getClientProfileId(req.user!.sub);
      await this.service.updateAnswers(clientId, req.body.answers);
      res.status(200).json({ message: req.t("answers_updated") });
    } catch (err) {
      this.handleError(res, err);
    }
  };
}
