import { Prisma, PrismaClient } from "@prisma/client";
import { randomUUID } from "crypto";
import { injectable, inject } from "tsyringe";
import { PrismaClientToken } from "../../di/tokens";
import { ServiceError } from "../../lib/service-error";
import { config } from "../../config";
import {
  buildConversationChannel,
  buildMessageCreatedPayload,
  publishMessageCreated,
} from "../../lib/ably";
import { encodeMessageCursor, MessageCursor } from "./messaging.validation";

export interface AuthContext {
  profileId: string;
  role: string;
}

export interface ConversationCounterpart {
  role: "coach" | "client";
  id: string | null;
  username: string | null;
  profile_image: string | null;
}

type CoachWithUser = {
  id: string;
  profile_image: string | null;
  user: { id: string; username: string } | null;
} | null;

type ClientWithUser = {
  id: string;
  profile_image: string | null;
  user: { id: string; username: string } | null;
} | null;

const conversationInclude: Prisma.conversationsInclude = {
  coach: {
    select: {
      id: true,
      profile_image: true,
      user: { select: { id: true, username: true } },
    },
  },
  client: {
    select: {
      id: true,
      profile_image: true,
      user: { select: { id: true, username: true } },
    },
  },
  messages: {
    where: { deleted_at: null },
    orderBy: [{ created_at: "desc" }, { id: "desc" }],
    take: 1,
  },
};

@injectable()
export class MessagingService {
  constructor(@inject(PrismaClientToken) private prisma: PrismaClient) {}

  private isUniqueViolation(err: unknown): boolean {
    return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
  }

  async resolveProfile(userId: string, role: string): Promise<string> {
    if (role === "coach") {
      const profile = await this.prisma.coach_profiles.findFirst({ where: { user_id: userId } });
      if (!profile) throw new ServiceError("coach_profile_not_found", 404);
      return profile.id;
    }
    if (role === "client") {
      const profile = await this.prisma.client_profiles.findFirst({ where: { user_id: userId } });
      if (!profile) throw new ServiceError("client_profile_not_found", 404);
      return profile.id;
    }
    throw new ServiceError("insufficient_permissions", 403);
  }

  private buildCoachCounterpart(coach: CoachWithUser): ConversationCounterpart {
    if (!coach) return { role: "coach", id: null, username: null, profile_image: null };
    return {
      role: "coach",
      id: coach.id,
      username: coach.user?.username ?? null,
      profile_image: coach.profile_image,
    };
  }

  private buildClientCounterpart(client: ClientWithUser): ConversationCounterpart {
    if (!client) return { role: "client", id: null, username: null, profile_image: null };
    return {
      role: "client",
      id: client.id,
      username: client.user?.username ?? null,
      profile_image: client.profile_image,
    };
  }

  private async loadConversationOrThrow(conversationId: string) {
    const conversation = await this.prisma.conversations.findUnique({
      where: { id: conversationId },
    });
    if (!conversation) throw new ServiceError("conversation_not_found", 404);
    return conversation;
  }

  /**
   * Verify the authenticated user can access the conversation.
   * Returns the conversation + resolved profile + assignment row.
   */
  async requireConversationAccess(userId: string, role: string, conversationId: string) {
    const profileId = await this.resolveProfile(userId, role);
    const conversation = await this.loadConversationOrThrow(conversationId);

    if (role === "coach" && conversation.coach_id !== profileId) {
      throw new ServiceError("forbidden", 403, ["not_conversation_member"]);
    }
    if (role === "client" && conversation.client_id !== profileId) {
      throw new ServiceError("forbidden", 403, ["not_conversation_member"]);
    }

    const assignment = await this.prisma.coach_clients.findUnique({
      where: { id: conversation.coach_client_id },
    });
    if (!assignment) {
      throw new ServiceError("forbidden", 403, ["assignment_missing_for_conversation"]);
    }

    return { conversation, profileId, assignment };
  }

  private async findOrCreateConversation(
    coachClientId: string,
    coachId: string,
    clientId: string,
  ) {
    const existing = await this.prisma.conversations.findFirst({
      where: { coach_client_id: coachClientId },
    });
    if (existing) return existing;

    try {
      return await this.prisma.conversations.create({
        data: {
          coach_client_id: coachClientId,
          coach_id: coachId,
          client_id: clientId,
        },
      });
    } catch (err) {
      if (this.isUniqueViolation(err)) {
        const winner = await this.prisma.conversations.findFirst({
          where: { coach_client_id: coachClientId },
        });
        if (winner) return winner;
        // Unique on (coach_id, client_id) may have won instead
        const pairWinner = await this.prisma.conversations.findFirst({
          where: { coach_id: coachId, client_id: clientId },
        });
        if (pairWinner) return pairWinner;
      }
      throw err;
    }
  }

  private async createMessageWithOutbox(
    tx: Prisma.TransactionClient,
    args: {
      conversationId: string;
      senderUserId: string;
      senderRole: string;
      content: string;
    },
  ) {
    const eventId = randomUUID();
    const message = await tx.messages.create({
      data: {
        conversation_id: args.conversationId,
        sender_user_id: args.senderUserId,
        sender_role: args.senderRole,
        content: args.content,
      },
    });

    await tx.conversations.update({
      where: { id: args.conversationId },
      data: { last_message_at: message.created_at },
    });

    const channel = buildConversationChannel(args.conversationId);
    const payload = buildMessageCreatedPayload({
      eventId,
      messageId: message.id,
      conversationId: args.conversationId,
      senderUserId: args.senderUserId,
      senderRole: args.senderRole,
      content: args.content,
      createdAt: message.created_at,
    });

    const event = await tx.outbox_events.create({
      data: {
        id: eventId,
        event_type: config.realtime.eventName,
        aggregate_type: "message",
        aggregate_id: message.id,
        channel,
        payload: payload as unknown as Prisma.InputJsonValue,
      },
    });

    return { message, event, channel, payload };
  }

  private async bestEffortPublish(channel: string, payload: ReturnType<typeof buildMessageCreatedPayload>) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("ably_publish_timeout")),
          config.realtime.publishTimeoutMs,
        );
      });
      await Promise.race([publishMessageCreated(channel, payload), timeout]);
    } catch (err) {
      // Transport-only failure: outbox row remains pending for cron retry.
      // Never log message content.
      const reason = err instanceof Error ? err.message : "unknown";
      console.error(`[messaging] post-commit Ably publish failed channel=${channel} reason=${reason}`);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async sendMessageToConversation(
    userId: string,
    role: string,
    conversationId: string,
    content: string,
  ) {
    const { conversation } = await this.requireConversationAccess(userId, role, conversationId);

    const result = await this.prisma.$transaction(async (tx) => {
      return this.createMessageWithOutbox(tx, {
        conversationId: conversation.id,
        senderUserId: userId,
        senderRole: role,
        content,
      });
    });

    // Opportunistic realtime delivery; failures stay retryable via outbox.
    // Awaited (not fire-and-forget): serverless runtimes may suspend the
    // function once the response is sent, killing background work.
    await this.bestEffortPublish(result.channel, result.payload);

    return { message: result.message, conversation };
  }

  async sendMessageByCoachClientId(userId: string, role: string, coachClientId: string, content: string) {
    const profileId = await this.resolveProfile(userId, role);

    // Assignment MUST exist in coach_clients table: lookup the assignment row
    // directly by its PK (coach_clients.id) and verify the caller owns it.
    // Coach owns via coach_id, client owns via client_id — either side can start.
    const assignment = await this.prisma.coach_clients.findUnique({
      where: { id: coachClientId },
    });
    if (!assignment) {
      throw new ServiceError("forbidden", 403, ["assignment_not_found"]);
    }
    if (role === "coach" && assignment.coach_id !== profileId) {
      throw new ServiceError("forbidden", 403, ["not_assignment_owner"]);
    }
    if (role === "client" && assignment.client_id !== profileId) {
      throw new ServiceError("forbidden", 403, ["not_assignment_owner"]);
    }

    const conversation = await this.findOrCreateConversation(
      assignment.id,
      assignment.coach_id,
      assignment.client_id,
    );

    // Re-verify membership after lazy create (owned by construction).
    if (role === "coach" && conversation.coach_id !== profileId) {
      throw new ServiceError("forbidden", 403, ["not_conversation_member"]);
    }
    if (role === "client" && conversation.client_id !== profileId) {
      throw new ServiceError("forbidden", 403, ["not_conversation_member"]);
    }

    const result = await this.prisma.$transaction(async (tx) => {
      return this.createMessageWithOutbox(tx, {
        conversationId: conversation.id,
        senderUserId: userId,
        senderRole: role,
        content,
      });
    });

    // See sendMessageToConversation: must be awaited on serverless.
    await this.bestEffortPublish(result.channel, result.payload);

    return { message: result.message, conversation };
  }

  /** @deprecated Use sendMessageByCoachClientId with coach_clients.id instead. */
  async sendMessageByClientId(coachUserId: string, clientProfileId: string, content: string) {
    const coachProfileId = await this.resolveProfile(coachUserId, "coach");

    const assignment = await this.prisma.coach_clients.findFirst({
      where: { coach_id: coachProfileId, client_id: clientProfileId },
    });
    if (!assignment) {
      throw new ServiceError("forbidden", 403, ["assignment_not_found"]);
    }

    const conversation = await this.findOrCreateConversation(
      assignment.id,
      assignment.coach_id,
      assignment.client_id,
    );

    // Re-verify membership after lazy create (coach owns it by construction).
    if (conversation.coach_id !== coachProfileId) {
      throw new ServiceError("forbidden", 403);
    }

    const result = await this.prisma.$transaction(async (tx) => {
      return this.createMessageWithOutbox(tx, {
        conversationId: conversation.id,
        senderUserId: coachUserId,
        senderRole: "coach",
        content,
      });
    });

    // See sendMessageToConversation: must be awaited on serverless.
    await this.bestEffortPublish(result.channel, result.payload);

    return { message: result.message, conversation };
  }

  async listConversations(userId: string, role: string, limit: number) {
    const profileId = await this.resolveProfile(userId, role);
    const bounded = Math.min(Math.max(limit || config.messaging.defaultLimit, 1), config.messaging.maxLimit);

    const where = role === "coach" ? { coach_id: profileId } : { client_id: profileId };
    const rows = await this.prisma.conversations.findMany({
      where,
      // NULLS LAST: Postgres sorts NULL first on DESC by default, which would
      // surface never-messaged conversations above recent chats.
      orderBy: [{ last_message_at: { sort: "desc", nulls: "last" } }, { updated_at: "desc" }],
      take: bounded,
      include: conversationInclude,
    });
    const conversations = rows.map((row) => {
      const { coach, client, messages, ...conversation } = row;
      return {
        ...conversation,
        counterpart:
          role === "coach"
            ? this.buildClientCounterpart(client as unknown as ClientWithUser)
            : this.buildCoachCounterpart(coach as unknown as CoachWithUser),
        last_message: (messages[0] ?? null) as unknown as typeof messages[number] | null,
      };
    });
    return { conversations };
  }

  async getConversation(userId: string, role: string, conversationId: string) {
    const { conversation } = await this.requireConversationAccess(userId, role, conversationId);
    const row = await this.prisma.conversations.findUnique({
      where: { id: conversation.id },
      include: conversationInclude,
    });
    if (!row) throw new ServiceError("conversation_not_found", 404);
    const { coach, client, messages, ...base } = row;
    return {
      conversation: {
        ...base,
        counterpart:
          role === "coach"
            ? this.buildClientCounterpart(client as unknown as ClientWithUser)
            : this.buildCoachCounterpart(coach as unknown as CoachWithUser),
        last_message: (messages[0] ?? null) as unknown as typeof messages[number] | null,
      },
    };
  }

  async getMessageHistory(
    userId: string,
    role: string,
    conversationId: string,
    before: MessageCursor | undefined,
    limit: number,
  ) {
    await this.requireConversationAccess(userId, role, conversationId);
    const bounded = Math.min(Math.max(limit || config.messaging.defaultLimit, 1), config.messaging.maxLimit);

    const cursorWhere = before
      ? {
          OR: [
            { created_at: { lt: before.createdAt } },
            { created_at: before.createdAt, id: { lt: before.id } },
          ],
        }
      : {};

    const rows = await this.prisma.messages.findMany({
      where: {
        conversation_id: conversationId,
        deleted_at: null,
        ...cursorWhere,
      },
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
      take: bounded + 1,
    });

    const hasMore = rows.length > bounded;
    const page = hasMore ? rows.slice(0, bounded) : rows;
    const oldest = page[page.length - 1];
    const nextCursor =
      hasMore && oldest ? encodeMessageCursor({ createdAt: oldest.created_at, id: oldest.id }) : undefined;

    // Client order is oldest-first (vice versa of the DB desc query) so chat
    // UIs can render top-to-bottom. Cursor pagination still walks backwards
    // from the oldest message of this page.
    return { messages: [...page].reverse(), nextCursor, hasMore };
  }
}
