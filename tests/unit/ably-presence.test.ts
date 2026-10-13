import "reflect-metadata";
import { isUserInChannel } from "../../src/lib/ably-presence";
import { resetAblyClient, setAblyRestClient } from "../../src/lib/ably";

afterEach(() => {
  resetAblyClient();
});

function fakeClient(presenceGet: jest.Mock) {
  return {
    channels: { get: jest.fn().mockReturnValue({ presence: { get: presenceGet } }) },
  } as never;
}

describe("isUserInChannel", () => {
  it("returns true when user is present in channel", async () => {
    const presenceGet = jest
      .fn()
      .mockResolvedValue({ items: [{ clientId: "user-1" }] });
    setAblyRestClient(fakeClient(presenceGet));
    const result = await isUserInChannel("conversation:c1", "user-1");
    expect(result).toBe(true);
    expect(presenceGet).toHaveBeenCalledWith({ clientId: "user-1" });
  });

  it("returns false when only other members are present (unfiltered list)", async () => {
    // If Ably ever ignores the clientId filter, the sender's own presence
    // must not count as the recipient being in the channel.
    const presenceGet = jest
      .fn()
      .mockResolvedValue({ items: [{ clientId: "sender-9" }, { clientId: "someone-else" }] });
    setAblyRestClient(fakeClient(presenceGet));
    const result = await isUserInChannel("conversation:c1", "user-1");
    expect(result).toBe(false);
  });

  it("returns false when user is not present", async () => {
    const presenceGet = jest.fn().mockResolvedValue({ items: [] });
    setAblyRestClient(fakeClient(presenceGet));
    const result = await isUserInChannel("conversation:c1", "user-1");
    expect(result).toBe(false);
  });

  it("returns false (fail-open) on error", async () => {
    const presenceGet = jest.fn().mockRejectedValue(new Error("ably error"));
    setAblyRestClient(fakeClient(presenceGet));
    const result = await isUserInChannel("conversation:c1", "user-1");
    expect(result).toBe(false);
  });

  it("returns false (fail-open) on timeout", async () => {
    const presenceGet = jest
      .fn()
      .mockImplementation(() => new Promise((_) => setTimeout(() => _, 5000)));
    setAblyRestClient(fakeClient(presenceGet));
    const result = await isUserInChannel("conversation:c1", "user-1");
    expect(result).toBe(false);
  }, 3000);

  it("returns false (fail-open) when ably is not configured", async () => {
    const saved = process.env.ABLY_API_KEY;
    delete process.env.ABLY_API_KEY;
    try {
      resetAblyClient();
      const result = await isUserInChannel("conversation:c1", "user-1");
      expect(result).toBe(false);
    } finally {
      if (saved !== undefined) process.env.ABLY_API_KEY = saved;
      resetAblyClient();
    }
  });
});
