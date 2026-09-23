import { injectable, inject } from "tsyringe";
import { MessagingService } from "../messaging/messaging.service";
import { ServiceError } from "../../lib/service-error";
import {
  buildConversationChannel,
  createConversationTokenRequest,
  getAblyApiKey,
} from "../../lib/ably";

@injectable()
export class RealtimeService {
  constructor(@inject(MessagingService) private messaging: MessagingService) {}

  async createAblyToken(userId: string, role: string, conversationId: string) {
    if (!getAblyApiKey()) {
      throw new ServiceError("ably_not_configured", 500);
    }
    // Throws 404/403 when unauthorized — never reveals other conversations.
    const { conversation } = await this.messaging.requireConversationAccess(
      userId,
      role,
      conversationId,
    );

    const channel = buildConversationChannel(conversation.id);
    const tokenRequest = await createConversationTokenRequest(channel, userId);

    return { tokenRequest, channel, conversationId: conversation.id };
  }
}
