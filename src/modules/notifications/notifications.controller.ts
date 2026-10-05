import { Request, Response } from "express";
import { injectable, inject } from "tsyringe";
import { NotificationsService } from "./notifications.service";
import { ServiceError } from "../../lib/service-error";
import {
  parseNotificationListQuery,
  validateNotificationId,
} from "./notifications.validation";

@injectable()
export class NotificationsController {
  constructor(@inject(NotificationsService) private service: NotificationsService) {}

  private handleError(res: Response, err: unknown) {
    if (err instanceof ServiceError) {
      const t = (res.req as Request).t || ((s: string) => s);
      res.status(err.statusCode).json({
        error: t(err.messageKey),
        code: err.messageKey,
        details: err.details ?? [err.messageKey],
      });
      return;
    }
    console.error("unexpected error:", err);
    const t = (res.req as Request).t || ((s: string) => s);
    res.status(500).json({ error: t("internal_server_error") });
  }

  list = async (req: Request, res: Response) => {
    const { result, errors } = parseNotificationListQuery(
      req.query as Record<string, unknown>,
    );
    if (errors.length > 0 || !result) {
      res.status(400).json({ error: req.t("validation_failed"), details: errors });
      return;
    }
    try {
      const { notifications, nextCursor, hasMore } = await this.service.list(
        req.user!.sub,
        result,
      );
      res.status(200).json({
        success: true,
        data: {
          notifications,
          nextCursor: nextCursor ?? null,
          hasMore,
        },
      });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  unreadCount = async (req: Request, res: Response) => {
    try {
      const unread_count = await this.service.unreadCount(req.user!.sub);
      res.status(200).json({ success: true, data: { unread_count } });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  markRead = async (req: Request, res: Response) => {
    const id = String(req.params.id ?? "");
    if (!validateNotificationId(id)) {
      res.status(400).json({ error: req.t("validation_failed"), details: ["invalid_uuid"] });
      return;
    }
    try {
      const notification = await this.service.markRead(req.user!.sub, id);
      res.status(200).json({ success: true, data: { notification } });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  markAllRead = async (req: Request, res: Response) => {
    try {
      const { updated } = await this.service.markAllRead(req.user!.sub);
      res.status(200).json({ success: true, data: { updated } });
    } catch (err) {
      this.handleError(res, err);
    }
  };
}
