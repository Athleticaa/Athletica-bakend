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

  private normalizeBody(body: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = { ...body };
    // phone aliases
    if (out.phoneNumber !== undefined && out.phone_number === undefined) out.phone_number = out.phoneNumber;
    if (out.phone !== undefined && out.phone_number === undefined) out.phone_number = out.phone;
    if (out.phoneNumber !== undefined) delete (out as Record<string, unknown>).phoneNumber;
    if (out.phone !== undefined) delete (out as Record<string, unknown>).phone;
    // location alias (handle capital L)
    if (out.Location !== undefined && out.location === undefined) out.location = out.Location;
    if (out.Location !== undefined) delete (out as Record<string, unknown>).Location;
    // birthDate -> birth_date for client
    if (out.birthDate !== undefined && out.birth_date === undefined) out.birth_date = out.birthDate;
    if (out.birthDate !== undefined) delete (out as Record<string, unknown>).birthDate;
    return out;
  }

  updateProfile = async (req: Request, res: Response) => {
    try {
      const userId = req.user!.sub;
      const role = req.user!.role;
      const body = this.normalizeBody(req.body as Record<string, unknown>);

      if (role === "coach") {
        const errors = validation.validateUpdateCoachProfile(body as Parameters<typeof validation.validateUpdateCoachProfile>[0], req.t);
        if (errors.length > 0) {
          res.status(400).json({ error: req.t("validation_failed"), details: errors });
          return;
        }
        const result = await this.profileService.updateCoachProfile(userId, body as Parameters<typeof validation.validateUpdateCoachProfile>[0]);
        res.status(200).json(result);
      } else {
        const errors = validation.validateUpdateClientProfile(body as Parameters<typeof validation.validateUpdateClientProfile>[0], req.t);
        if (errors.length > 0) {
          res.status(400).json({ error: req.t("validation_failed"), details: errors });
          return;
        }
        const result = await this.profileService.updateClientProfile(userId, body as Parameters<typeof validation.validateUpdateClientProfile>[0]);
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
