import { Request, Response } from "express";
import { injectable, container } from "tsyringe";
import { ProfileService, ServiceError } from "./profile.service";
import * as validation from "./profile.validation";

@injectable()
export class ProfileController {
  private profileService: ProfileService;

  constructor() {
    this.profileService = container.resolve(ProfileService);
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

  getProfile = async (req: Request, res: Response) => {
    try {
      const userId = req.user!.sub;
      const role = req.user!.role;

      if (role === "coach") {
        const result = await this.profileService.getCoachProfile(userId);
        res.status(200).json(result);
      } else {
        const result = await this.profileService.getClientProfile(userId);
        res.status(200).json(result);
      }
    } catch (err) {
      this.handleError(res, err);
    }
  };

  updateProfile = async (req: Request, res: Response) => {
    try {
      const userId = req.user!.sub;
      const role = req.user!.role;

      if (role === "coach") {
        const errors = validation.validateUpdateCoachProfile(req.body, req.t);
        if (errors.length > 0) {
          res.status(400).json({ error: req.t("validation_failed"), details: errors });
          return;
        }
        const result = await this.profileService.updateCoachProfile(userId, req.body);
        res.status(200).json(result);
      } else {
        const errors = validation.validateUpdateClientProfile(req.body, req.t);
        if (errors.length > 0) {
          res.status(400).json({ error: req.t("validation_failed"), details: errors });
          return;
        }
        const result = await this.profileService.updateClientProfile(userId, req.body);
        res.status(200).json(result);
      }
    } catch (err) {
      this.handleError(res, err);
    }
  };

  uploadImage = async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: req.t("image_required") });
        return;
      }

      const userId = req.user!.sub;
      const role = req.user!.role;

      if (role === "coach") {
        const result = await this.profileService.uploadCoachProfileImage(userId, req.file);
        res.status(200).json(result);
      } else {
        const result = await this.profileService.uploadClientProfileImage(userId, req.file);
        res.status(200).json(result);
      }
    } catch (err) {
      this.handleError(res, err);
    }
  };

  deleteImage = async (req: Request, res: Response) => {
    try {
      const userId = req.user!.sub;
      const role = req.user!.role;

      if (role === "coach") {
        const result = await this.profileService.deleteCoachProfileImage(userId);
        res.status(200).json({ message: req.t(result.message) });
      } else {
        const result = await this.profileService.deleteClientProfileImage(userId);
        res.status(200).json({ message: req.t(result.message) });
      }
    } catch (err) {
      this.handleError(res, err);
    }
  };
}
