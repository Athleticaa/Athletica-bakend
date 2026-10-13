import { Request, Response } from "express";
import { injectable, inject } from "tsyringe";
import { DevicesService } from "./devices.service";
import { ServiceError } from "../../lib/service-error";
import {
  validateDeviceIdentifier,
  validateRegisterDevice,
} from "./devices.validation";

@injectable()
export class DevicesController {
  constructor(@inject(DevicesService) private service: DevicesService) {}

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

  register = async (req: Request, res: Response) => {
    const { input, errors } = validateRegisterDevice(req.body);
    if (!input) {
      res.status(400).json({ error: req.t("validation_failed"), details: errors });
      return;
    }
    try {
      const device = await this.service.register(req.user!.sub, input);
      res.status(201).json({ device });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  unregister = async (req: Request, res: Response) => {
    const { device_id, fcm_token, errors } = validateDeviceIdentifier(req.body);
    if (errors.length > 0) {
      res.status(400).json({ error: req.t("validation_failed"), details: errors });
      return;
    }
    try {
      await this.service.unregister(req.user!.sub, device_id, fcm_token);
      res.status(200).json({ message: req.t("device_removed") });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  heartbeat = async (req: Request, res: Response) => {
    const raw = req.body?.device_id;
    const { device_id, errors } = validateDeviceIdentifier(
      typeof raw === "string" ? { device_id: raw } : {},
    );
    if (!device_id || errors.length > 0) {
      res.status(400).json({ error: req.t("validation_failed"), details: errors });
      return;
    }
    try {
      const result = await this.service.heartbeat(req.user!.sub, device_id);
      res.status(200).json(result);
    } catch (err) {
      this.handleError(res, err);
    }
  };
}
