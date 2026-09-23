import * as Ably from "ably";
import { config } from "../config";

let restClient: Ably.Rest | null = null;

export function getAblyApiKey(): string | undefined {
  return process.env.ABLY_API_KEY;
}

export function getAblyRestClient(): Ably.Rest {
  const apiKey = getAblyApiKey();
  if (!apiKey) {
    throw new Error("ably_not_configured");
  }
  if (!restClient) {
    restClient = new Ably.Rest(apiKey);
  }
  return restClient;
}

/** For tests: reset the cached client. */
export function resetAblyClient(): void {
  restClient = null;
}

/** For tests: inject a fake client. */
export function setAblyRestClient(client: Ably.Rest | null): void {
  restClient = client;
}

export function buildConversationChannel(conversationId: string): string {
  return `${config.realtime.channelPrefix}:${conversationId}`;
}

export function buildChannelCapability(channel: string): string {
  return JSON.stringify({ [channel]: ["subscribe", "history"] });
}

export interface MessageCreatedPayload {
  id: string;
  type: "message.created";
  occurredAt: string;
  payload: {
    messageId: string;
    conversationId: string;
    senderUserId: string;
    senderRole: string;
    content: string;
    createdAt: string;
  };
}

export function buildMessageCreatedPayload(args: {
  eventId: string;
  messageId: string;
  conversationId: string;
  senderUserId: string;
  senderRole: string;
  content: string;
  createdAt: Date;
  occurredAt?: Date;
}): MessageCreatedPayload {
  const occurredAt = (args.occurredAt ?? args.createdAt).toISOString();
  return {
    id: args.eventId,
    type: "message.created",
    occurredAt,
    payload: {
      messageId: args.messageId,
      conversationId: args.conversationId,
      senderUserId: args.senderUserId,
      senderRole: args.senderRole,
      content: args.content,
      createdAt: args.createdAt.toISOString(),
    },
  };
}

export async function publishMessageCreated(
  channel: string,
  data: MessageCreatedPayload,
  client?: Ably.Rest,
): Promise<void> {
  const rest = client ?? getAblyRestClient();
  await rest.channels.get(channel).publish(config.realtime.eventName, data);
}

export async function createConversationTokenRequest(
  channel: string,
  clientId: string,
  client?: Ably.Rest,
): Promise<Ably.TokenRequest> {
  const rest = client ?? getAblyRestClient();
  const capability = buildChannelCapability(channel);
  return rest.auth.createTokenRequest({
    clientId,
    capability,
  });
}
