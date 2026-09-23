import { Request, Response } from "express";
import { injectable, inject } from "tsyringe";
import { MessagingService } from "./messaging.service";
import { ServiceError } from "../../lib/service-error";
import {
  isValidUuid,
  parseMessageHistoryQuery,
  validateSendMessage,
} from "./messaging.validation";
import { config } from "../../config";

function mapConversation(c: {
  id: string;
  coach_client_id: string;
  coach_id: string;
  client_id: string;
  created_at: Date;
  updated_at: Date;
  last_message_at: Date | null;
  counterpart?: unknown;
  last_message?: {
    id: string;
    conversation_id: string;
    sender_user_id: string;
    sender_role: string;
    content: string;
    created_at: Date;
    updated_at: Date;
  } | null;
}) {
  return {
    id: c.id,
    coach_client_id: c.coach_client_id,
    coach_id: c.coach_id,
    client_id: c.client_id,
    created_at: c.created_at,
    updated_at: c.updated_at,
    last_message_at: c.last_message_at,
    counterpart: (c.counterpart ?? null) as unknown,
    last_message: c.last_message ? mapMessage(c.last_message) : null,
  };
}

function mapMessage(m: {
  id: string;
  conversation_id: string;
  sender_user_id: string;
  sender_role: string;
  content: string;
  created_at: Date;
  updated_at: Date;
}) {
  return {
    id: m.id,
    conversation_id: m.conversation_id,
    sender_user_id: m.sender_user_id,
    sender_role: m.sender_role,
    content: m.content,
    created_at: m.created_at,
    updated_at: m.updated_at,
  };
}

@injectable()
export class MessagingController {
  constructor(@inject(MessagingService) private service: MessagingService) {}

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

  listConversations = async (req: Request, res: Response) => {
    try {
      const rawLimit = req.query.limit;
      let limit: number = config.messaging.defaultLimit;
      if (rawLimit !== undefined) {
        const parsed = Number(rawLimit);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > config.messaging.maxLimit) {
          res.status(400).json({ error: req.t("validation_failed"), details: ["invalid_limit"] });
          return;
        }
        limit = parsed;
      }
      const { conversations } = await this.service.listConversations(
        req.user!.sub,
        req.user!.role,
        limit,
      );
      res.status(200).json({ success: true, data: { conversations: conversations.map(mapConversation) } });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  getConversation = async (req: Request, res: Response) => {
    const conversationId = String(req.params.conversationId ?? req.params.id);
    if (!isValidUuid(conversationId)) {
      res.status(400).json({ error: req.t("validation_failed"), details: ["invalid_uuid"] });
      return;
    }
    try {
      const { conversation } = await this.service.getConversation(
        req.user!.sub,
        req.user!.role,
        conversationId,
      );
      res.status(200).json({ success: true, data: { conversation: mapConversation(conversation) } });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  sendToConversation = async (req: Request, res: Response) => {
    const conversationId = String(req.params.conversationId ?? req.params.id);
    if (!isValidUuid(conversationId)) {
      res.status(400).json({ error: req.t("validation_failed"), details: ["invalid_uuid"] });
      return;
    }
    const { content, errors } = validateSendMessage(req.body);
    if (errors.length > 0) {
      res.status(400).json({ error: req.t("validation_failed"), details: errors });
      return;
    }
    try {
      const { message, conversation } = await this.service.sendMessageToConversation(
        req.user!.sub,
        req.user!.role,
        conversationId,
        content!,
      );
      res.status(201).json({
        success: true,
        data: {
          message: mapMessage(message),
          conversation: mapConversation({ ...conversation, last_message: message }),
        },
      });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  sendByCoachClientId = async (req: Request, res: Response) => {
    const coachClientId = String(req.params.coachClientId);
    if (!isValidUuid(coachClientId)) {
      res.status(400).json({ error: req.t("validation_failed"), details: ["invalid_uuid"] });
      return;
    }
    const { content, errors } = validateSendMessage(req.body);
    if (errors.length > 0) {
      res.status(400).json({ error: req.t("validation_failed"), details: errors });
      return;
    }
    try {
      const { message, conversation } = await this.service.sendMessageByCoachClientId(
        req.user!.sub,
        req.user!.role,
        coachClientId,
        content!,
      );
      res.status(201).json({
        success: true,
        data: {
          message: mapMessage(message),
          conversation: mapConversation({ ...conversation, last_message: message }),
        },
      });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  /** @deprecated Use sendByCoachClientId with coach_clients.id instead. */
  sendByClientId = async (req: Request, res: Response) => {
    const clientId = String(req.params.clientId);
    if (!isValidUuid(clientId)) {
      res.status(400).json({ error: req.t("validation_failed"), details: ["invalid_uuid"] });
      return;
    }
    const { content, errors } = validateSendMessage(req.body);
    if (errors.length > 0) {
      res.status(400).json({ error: req.t("validation_failed"), details: errors });
      return;
    }
    try {
      const { message, conversation } = await this.service.sendMessageByClientId(
        req.user!.sub,
        clientId,
        content!,
      );
      res.status(201).json({
        success: true,
        data: {
          message: mapMessage(message),
          conversation: mapConversation({ ...conversation, last_message: message }),
        },
      });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  getHistory = async (req: Request, res: Response) => {
    const conversationId = String(req.params.conversationId ?? req.params.id);
    if (!isValidUuid(conversationId)) {
      res.status(400).json({ error: req.t("validation_failed"), details: ["invalid_uuid"] });
      return;
    }
    const { result, errors } = parseMessageHistoryQuery(req.query as Record<string, unknown>);
    if (errors.length > 0 || !result) {
      res.status(400).json({ error: req.t("validation_failed"), details: errors });
      return;
    }
    try {
      const { messages, nextCursor, hasMore } = await this.service.getMessageHistory(
        req.user!.sub,
        req.user!.role,
        conversationId,
        result.before,
        result.limit,
      );
      res.status(200).json({
        success: true,
        data: {
          messages: messages.map(mapMessage),
          nextCursor: nextCursor ?? null,
          hasMore,
        },
      });
    } catch (err) {
      this.handleError(res, err);
    }
  };
}
