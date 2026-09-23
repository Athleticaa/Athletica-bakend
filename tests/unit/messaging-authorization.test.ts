import "reflect-metadata";
import { MessagingService } from "../../src/modules/messaging/messaging.service";
import { ServiceError } from "../../src/lib/service-error";

const CONV_ID = "123e4567-e89b-12d3-a456-426614174000";
const COACH_PROFILE = "223e4567-e89b-12d3-a456-426614174000";
const CLIENT_PROFILE = "323e4567-e89b-12d3-a456-426614174000";
const OTHER_COACH = "423e4567-e89b-12d3-a456-426614174000";
const OTHER_CLIENT = "523e4567-e89b-12d3-a456-426614174000";
const CC_ID = "623e4567-e89b-12d3-a456-426614174000";

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    coach_profiles: { findFirst: jest.fn() },
    client_profiles: { findFirst: jest.fn() },
    conversations: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
    coach_clients: { findUnique: jest.fn(), findFirst: jest.fn() },
    messages: { create: jest.fn(), findMany: jest.fn() },
    outbox_events: { create: jest.fn() },
    $transaction: jest.fn(),
    ...overrides,
  };
}

function serviceWith(prisma: ReturnType<typeof makePrisma>) {
  return new MessagingService(prisma as never);
}

function expectServiceError(promise: Promise<unknown>, key: string, status: number) {
  return promise.then(
    () => {
      throw new Error("expected ServiceError");
    },
    (err) => {
      expect(err).toBeInstanceOf(ServiceError);
      expect((err as ServiceError).messageKey).toBe(key);
      expect((err as ServiceError).statusCode).toBe(status);
    },
  );
}

beforeEach(() => jest.clearAllMocks());

describe("MessagingService.requireConversationAccess", () => {
  const baseConversation = {
    id: CONV_ID,
    coach_client_id: CC_ID,
    coach_id: COACH_PROFILE,
    client_id: CLIENT_PROFILE,
    created_at: new Date(),
    updated_at: new Date(),
    last_message_at: null,
  };

  it("allows the owning coach", async () => {
    const prisma = makePrisma();
    (prisma.coach_profiles.findFirst as jest.Mock).mockResolvedValue({ id: COACH_PROFILE });
    (prisma.conversations.findUnique as jest.Mock).mockResolvedValue(baseConversation);
    (prisma.coach_clients.findUnique as jest.Mock).mockResolvedValue({ id: CC_ID });
    const svc = serviceWith(prisma);
    const out = await svc.requireConversationAccess("coach-user", "coach", CONV_ID);
    expect(out.profileId).toBe(COACH_PROFILE);
    expect(out.conversation.id).toBe(CONV_ID);
  });

  it("allows the owning client", async () => {
    const prisma = makePrisma();
    (prisma.client_profiles.findFirst as jest.Mock).mockResolvedValue({ id: CLIENT_PROFILE });
    (prisma.conversations.findUnique as jest.Mock).mockResolvedValue(baseConversation);
    (prisma.coach_clients.findUnique as jest.Mock).mockResolvedValue({ id: CC_ID });
    const svc = serviceWith(prisma);
    const out = await svc.requireConversationAccess("client-user", "client", CONV_ID);
    expect(out.profileId).toBe(CLIENT_PROFILE);
  });

  it("forbids another coach's conversation", async () => {
    const prisma = makePrisma();
    (prisma.coach_profiles.findFirst as jest.Mock).mockResolvedValue({ id: OTHER_COACH });
    (prisma.conversations.findUnique as jest.Mock).mockResolvedValue(baseConversation);
    const svc = serviceWith(prisma);
    await expectServiceError(
      svc.requireConversationAccess("other-coach-user", "coach", CONV_ID),
      "forbidden",
      403,
    );
  });

  it("forbids another client's conversation", async () => {
    const prisma = makePrisma();
    (prisma.client_profiles.findFirst as jest.Mock).mockResolvedValue({ id: OTHER_CLIENT });
    (prisma.conversations.findUnique as jest.Mock).mockResolvedValue(baseConversation);
    const svc = serviceWith(prisma);
    await expectServiceError(
      svc.requireConversationAccess("other-client-user", "client", CONV_ID),
      "forbidden",
      403,
    );
  });

  it("returns 404 for unknown conversation", async () => {
    const prisma = makePrisma();
    (prisma.coach_profiles.findFirst as jest.Mock).mockResolvedValue({ id: COACH_PROFILE });
    (prisma.conversations.findUnique as jest.Mock).mockResolvedValue(null);
    const svc = serviceWith(prisma);
    await expectServiceError(
      svc.requireConversationAccess("coach-user", "coach", CONV_ID),
      "conversation_not_found",
      404,
    );
  });

  it("forbids sends after the assignment is gone", async () => {
    const prisma = makePrisma();
    (prisma.coach_profiles.findFirst as jest.Mock).mockResolvedValue({ id: COACH_PROFILE });
    (prisma.conversations.findUnique as jest.Mock).mockResolvedValue(baseConversation);
    (prisma.coach_clients.findUnique as jest.Mock).mockResolvedValue(null);
    const svc = serviceWith(prisma);
    await expectServiceError(
      svc.requireConversationAccess("coach-user", "coach", CONV_ID),
      "forbidden",
      403,
    );
  });

  it("returns 404 when the profile does not exist", async () => {
    const prisma = makePrisma();
    (prisma.coach_profiles.findFirst as jest.Mock).mockResolvedValue(null);
    const svc = serviceWith(prisma);
    await expectServiceError(
      svc.requireConversationAccess("ghost", "coach", CONV_ID),
      "coach_profile_not_found",
      404,
    );
  });
});

describe("MessagingService.sendMessageByClientId", () => {
  it("rejects an unassigned coach-client pair", async () => {
    const prisma = makePrisma();
    (prisma.coach_profiles.findFirst as jest.Mock).mockResolvedValue({ id: COACH_PROFILE });
    (prisma.coach_clients.findFirst as jest.Mock).mockResolvedValue(null);
    const svc = serviceWith(prisma);
    await expectServiceError(
      svc.sendMessageByClientId("coach-user", CLIENT_PROFILE, "hi"),
      "forbidden",
      403,
    );
  });
});
