import { Request, Response } from "express";
import { injectable, inject } from "tsyringe";
import { CheckInService } from "./checkin.service";
import { ServiceError } from "../../lib/service-error";
import * as v from "./checkin.validation";

@injectable()
export class CheckInController {
  constructor(@inject(CheckInService) private service: CheckInService) {}

  private handleError(res: Response, err: unknown): void {
    const req = res.req as Request;
    const t = req.t ?? ((k: string) => k);
    if (err instanceof ServiceError) {
      res.status(err.statusCode).json({ error: t(err.messageKey), details: err.details ?? undefined });
      return;
    }
    console.error("unexpected error:", err);
    res.status(500).json({ error: t("internal_server_error") });
  }

  // ── Coach ─────────────────────────────────────────────────────────────────

  getMyQuestions = async (req: Request, res: Response): Promise<void> => {
    try {
      const coachId = await this.service.getCoachProfileId(req.user!.sub);
      const questions = await this.service.getMyQuestions(coachId);
      res.json({ questions });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  createQuestion = async (req: Request, res: Response): Promise<void> => {
    const errors = v.validateCreateQuestion(req.body, req.t);
    if (errors.length > 0) {
      res.status(400).json({ error: req.t("validation_failed"), details: errors });
      return;
    }
    try {
      const coachId = await this.service.getCoachProfileId(req.user!.sub);
      const question = await this.service.createQuestion(coachId, req.body);
      res.status(201).json({ question });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  updateQuestion = async (req: Request, res: Response): Promise<void> => {
    const questionId = String(req.params.id);
    if (!v.isValidUuid(questionId)) {
      res.status(400).json({ error: req.t("invalid_uuid") });
      return;
    }
    const errors = v.validateUpdateQuestion(req.body, req.t);
    if (errors.length > 0) {
      res.status(400).json({ error: req.t("validation_failed"), details: errors });
      return;
    }
    try {
      const coachId = await this.service.getCoachProfileId(req.user!.sub);
      const question = await this.service.updateQuestion(coachId, questionId, req.body);
      res.json({ question });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  deleteQuestion = async (req: Request, res: Response): Promise<void> => {
    const questionId = String(req.params.id);
    if (!v.isValidUuid(questionId)) {
      res.status(400).json({ error: req.t("invalid_uuid") });
      return;
    }
    try {
      const coachId = await this.service.getCoachProfileId(req.user!.sub);
      await this.service.deleteQuestion(coachId, questionId);
      res.json({ message: req.t("checkin_question_deleted") });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  reorderQuestions = async (req: Request, res: Response): Promise<void> => {
    const errors = v.validateReorderQuestions(req.body, req.t);
    if (errors.length > 0) {
      res.status(400).json({ error: req.t("validation_failed"), details: errors });
      return;
    }
    try {
      const coachId = await this.service.getCoachProfileId(req.user!.sub);
      const questions = await this.service.reorderQuestions(coachId, req.body.question_ids);
      res.json({ questions });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  getClientSubmissions = async (req: Request, res: Response): Promise<void> => {
    const coachClientId = String(req.params.coachClientId);
    if (!v.isValidUuid(coachClientId)) {
      res.status(400).json({ error: req.t("invalid_uuid") });
      return;
    }
    try {
      const coachId = await this.service.getCoachProfileId(req.user!.sub);
      const submissions = await this.service.getClientSubmissions(coachId, coachClientId);
      res.json({ submissions });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  getClientCheckinStatus = async (req: Request, res: Response): Promise<void> => {
    const coachClientId = String(req.params.coachClientId);
    if (!v.isValidUuid(coachClientId)) {
      res.status(400).json({ error: req.t("invalid_uuid") });
      return;
    }
    try {
      const coachId = await this.service.getCoachProfileId(req.user!.sub);
      const status = await this.service.getClientCheckinStatus(coachId, coachClientId);
      res.json(status);
    } catch (err) {
      this.handleError(res, err);
    }
  };

  getSubmissionDetail = async (req: Request, res: Response): Promise<void> => {
    const coachClientId = String(req.params.coachClientId);
    const submissionId = String(req.params.submissionId);
    if (!v.isValidUuid(coachClientId) || !v.isValidUuid(submissionId)) {
      res.status(400).json({ error: req.t("invalid_uuid") });
      return;
    }
    try {
      const coachId = await this.service.getCoachProfileId(req.user!.sub);
      const submission = await this.service.getSubmissionDetail(coachId, coachClientId, submissionId);
      res.json({ submission });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  assignCheckIn = async (req: Request, res: Response): Promise<void> => {
    const errors = v.validateAssignCheckIn(req.body, req.t);
    if (errors.length > 0) {
      res.status(400).json({ error: req.t("validation_failed"), details: errors });
      return;
    }
    try {
      const coachId = await this.service.getCoachProfileId(req.user!.sub);
      const assignment = await this.service.assignCheckIn(coachId, req.body.coach_client_id);
      res.status(201).json({ message: req.t("checkin_assigned"), assignment });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  // ── Client ────────────────────────────────────────────────────────────────

  getCoachQuestions = async (req: Request, res: Response): Promise<void> => {
    try {
      const clientId = await this.service.getClientProfileId(req.user!.sub);
      const questions = await this.service.getCoachQuestionsForClient(clientId);
      res.json({ questions });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  submitCheckIn = async (req: Request, res: Response): Promise<void> => {
    // The request is multipart/form-data.
    // - req.body.answers  → JSON string array of { question_id, answer_value }
    // - req.files         → image files keyed by question_id
    let parsedAnswers: v.SubmitAnswerItem[] = [];
    try {
      const raw = req.body.answers;
      parsedAnswers = typeof raw === "string" ? JSON.parse(raw) : (Array.isArray(raw) ? raw : []);
    } catch {
      res.status(400).json({ error: req.t("checkin_answers_invalid_json") });
      return;
    }

    const errors = v.validateSubmitCheckIn({ answers: parsedAnswers }, req.t);
    if (errors.length > 0) {
      res.status(400).json({ error: req.t("validation_failed"), details: errors });
      return;
    }

    try {
      const clientId = await this.service.getClientProfileId(req.user!.sub);

      // Upload any attached image files to Cloudinary
      // NOTE: upload.any() populates req.files as an array, not a dict.
      const uploadedImages: Record<string, string> = {};
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];

      for (const file of files) {
        // Field name must be a valid UUID (= a question_id for an IMAGE question)
        if (v.isValidUuid(file.fieldname)) {
          const url = await this.service.uploadCheckInPhoto(file);
          uploadedImages[file.fieldname] = url;
        }
      }

      const submission = await this.service.submitCheckIn(clientId, parsedAnswers, uploadedImages);
      res.status(201).json({ submission_id: submission.id, submitted_at: submission.submitted_at });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  getMySubmissions = async (req: Request, res: Response): Promise<void> => {
    try {
      const clientId = await this.service.getClientProfileId(req.user!.sub);
      const submissions = await this.service.getMySubmissions(clientId);
      res.json({ submissions });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  getMySubmissionDetail = async (req: Request, res: Response): Promise<void> => {
    const submissionId = String(req.params.submissionId);
    if (!v.isValidUuid(submissionId)) {
      res.status(400).json({ error: req.t("invalid_uuid") });
      return;
    }
    try {
      const clientId = await this.service.getClientProfileId(req.user!.sub);
      const submission = await this.service.getMySubmissionDetail(clientId, submissionId);
      res.json({ submission });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  hasPendingAssignment = async (req: Request, res: Response): Promise<void> => {
    try {
      const clientId = await this.service.getClientProfileId(req.user!.sub);
      const hasPending = await this.service.hasPendingAssignment(clientId);
      res.json({ has_pending: hasPending });
    } catch (err) {
      this.handleError(res, err);
    }
  };
}
