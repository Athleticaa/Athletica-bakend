import "reflect-metadata";
import { RealtimeService } from "../../src/modules/realtime/realtime.service";
import { ServiceError } from "../../src/lib/service-error";
import {
  buildChannelCapability,
  buildConversationChannel,
  resetAblyClient,
} from "../../src/lib/ably";

const CONV_ID = "123e4567-e89b-12d3-a456-426614174000";
// Well-formed dummy key: local token-request signing needs no network.
const DUMMY_KEY = "gGJdQw.testKey:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

describe("Ably channel capability", () => {
  it("builds a conversation-scoped channel", () => {
    expect(buildConversationChannel(CONV_ID)).toBe(`conversation:${CONV_ID}`);
  });

  it("grants only the requested conversation channel", () => {
    const channel = buildConversationChannel(CONV_ID);
    const capability = JSON.parse(buildChannelCapability(channel));
    expect(Object.keys(capability)).toEqual([channel]);
    expect(capability[channel]).toContain("subscribe");
  });

  it("does not grant wildcard capabilities", () => {
    const capability = buildChannelCapability(buildConversationChannel(CONV_ID));
    expect(capability).not.toContain('"*"');
  });
});

describe("RealtimeService.createAblyToken", () => {
  const OLD_KEY = process.env.ABLY_API_KEY;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ABLY_API_KEY = DUMMY_KEY;
    resetAblyClient();
  });

  afterAll(() => {
    process.env.ABLY_API_KEY = OLD_KEY;
    resetAblyClient();
  });

  it("returns a narrow token for an authorized conversation", async () => {
    const messaging = {
      requireConversationAccess: jest.fn().mockResolvedValue({
        conversation: { id: CONV_ID },
      }),
    };

    const svc = new RealtimeService(messaging as never);
    const out = await svc.createAblyToken("user-1", "coach", CONV_ID);
    expect(messaging.requireConversationAccess).toHaveBeenCalledWith("user-1", "coach", CONV_ID);
    expect(out.channel).toBe(`conversation:${CONV_ID}`);
    expect(out.conversationId).toBe(CONV_ID);
    // Token request is locally signed — assert narrow capability without network.
    const cap = JSON.parse((out.tokenRequest as { capability: string }).capability);
    expect(Object.keys(cap)).toEqual([`conversation:${CONV_ID}`]);
  });

  it("rejects unauthorized conversations without minting a token", async () => {
    const messaging = {
      requireConversationAccess: jest
        .fn()
        .mockRejectedValue(new ServiceError("forbidden", 403)),
    };
    const svc = new RealtimeService(messaging as never);
    await expect(svc.createAblyToken("user-x", "client", CONV_ID)).rejects.toMatchObject({
      messageKey: "forbidden",
    });
    expect(messaging.requireConversationAccess).toHaveBeenCalled();
  });
});
