import { Request, Response } from "express";
import { injectable, inject } from "tsyringe";
import { RealtimeService } from "./realtime.service";
import { ServiceError } from "../../lib/service-error";
import { isValidUuid } from "../messaging/messaging.validation";

@injectable()
export class RealtimeController {
  constructor(@inject(RealtimeService) private service: RealtimeService) {}

  private handleError(res: Response, err: unknown) {
    if (err instanceof ServiceError) {
      const t = (res.req as Request).t || ((s: string) => s);
      res.status(err.statusCode).json({ error: t(err.messageKey) });
      return;
    }
    if (err instanceof Error && err.message === "ably_not_configured") {
      const t = (res.req as Request).t || ((s: string) => s);
      res.status(500).json({ error: t("ably_not_configured") });
      return;
    }
    console.error("unexpected error:", err);
    const t = (res.req as Request).t || ((s: string) => s);
    res.status(500).json({ error: t("internal_server_error") });
  }

  getAblyToken = async (req: Request, res: Response) => {
    const raw = req.query.conversationId ?? req.query.conversation_id;
    const conversationId = Array.isArray(raw) ? raw[0] : raw;
    if (typeof conversationId !== "string" || !isValidUuid(conversationId)) {
      res.status(400).json({ error: req.t("validation_failed"), details: ["invalid_uuid"] });
      return;
    }
    try {
      const result = await this.service.createAblyToken(
        req.user!.sub,
        req.user!.role,
        conversationId,
      );
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      this.handleError(res, err);
    }
  };
}
