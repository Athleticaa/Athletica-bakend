import { OAuth2Client } from "google-auth-library";
import { validateGoogleLogin } from "../../src/modules/auth/auth.validation";

process.env.GOOGLE_WEB_CLIENT_ID = "test-web-client-id.apps.googleusercontent.com";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const googleAuth = require("../../src/lib/google-auth");
const { sanitizeGoogleUsername, verifyGoogleIdToken, setGoogleAuthClientForTests } = googleAuth;

function fakeClient(impl: (opts: unknown) => Promise<unknown>) {
  return { verifyIdToken: jest.fn(impl) } as unknown as OAuth2Client;
}

afterEach(() => {
  setGoogleAuthClientForTests(null);
  jest.restoreAllMocks();
});

describe("sanitizeGoogleUsername", () => {
  it("keeps valid letters-and-spaces names unchanged", () => {
    expect(sanitizeGoogleUsername("John Doe", "john@example.com")).toBe("John Doe");
  });

  it("strips dots, digits and symbols", () => {
    expect(sanitizeGoogleUsername("John.Doe123!", "john@example.com")).toBe("John Doe");
  });

  it("falls back to the email prefix when the name is unusable", () => {
    expect(sanitizeGoogleUsername("😀🎉", "jane.doe@example.com")).toBe("jane doe");
  });

  it("falls back to a generic default when nothing survives", () => {
    expect(sanitizeGoogleUsername("12345", "67890@example.com")).toBe("Athletica User");
  });

  it("handles non-string names via the email prefix", () => {
    expect(sanitizeGoogleUsername(undefined, "sam@example.com")).toBe("sam");
  });

  it("truncates to 100 chars without trailing space", () => {
    const long = `${"a".repeat(60)} ${"b".repeat(60)}`;
    const out: string = sanitizeGoogleUsername(long, "x@example.com");
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out.endsWith(" ")).toBe(false);
  });
});

describe("validateGoogleLogin", () => {
  it("requires idToken", () => {
    expect(validateGoogleLogin({ idToken: "" })).toContain("idToken_required");
  });

  it("rejects invalid role values up front", () => {
    expect(validateGoogleLogin({ idToken: "x", role: "admin" })).toContain("role_invalid");
  });

  it("accepts idToken alone (returning users need no role)", () => {
    expect(validateGoogleLogin({ idToken: "x" })).toEqual([]);
  });

  it("accepts coach/client roles", () => {
    expect(validateGoogleLogin({ idToken: "x", role: "coach" })).toEqual([]);
    expect(validateGoogleLogin({ idToken: "x", role: "client" })).toEqual([]);
  });
});

describe("verifyGoogleIdToken", () => {
  const payload = {
    sub: "google-sub-1",
    email: "user@example.com",
    name: "Test User",
    email_verified: true,
    iss: "accounts.google.com",
  };

  it("returns the verified account for a good token", async () => {
    setGoogleAuthClientForTests(fakeClient(async () => ({ getPayload: () => payload })));
    await expect(verifyGoogleIdToken("good-token")).resolves.toEqual({
      sub: "google-sub-1",
      email: "user@example.com",
      name: "Test User",
      emailVerified: true,
    });
  });

  it("rejects when Google reports the email as unverified", async () => {
    setGoogleAuthClientForTests(fakeClient(async () => ({ getPayload: () => ({ ...payload, email_verified: false }) })));
    await expect(verifyGoogleIdToken("t")).rejects.toThrow("google_token_invalid");
  });

  it("rejects untrusted issuers", async () => {
    setGoogleAuthClientForTests(fakeClient(async () => ({ getPayload: () => ({ ...payload, iss: "evil.example.com" }) })));
    await expect(verifyGoogleIdToken("t")).rejects.toThrow("google_token_invalid");
  });

  it("rejects when the library throws (bad signature / expired)", async () => {
    setGoogleAuthClientForTests(
      fakeClient(async () => {
        throw new Error("invalid signature");
      })
    );
    await expect(verifyGoogleIdToken("t")).rejects.toThrow("google_token_invalid");
  });

  it("throws a config error when GOOGLE_WEB_CLIENT_ID is missing", async () => {
    const saved = process.env.GOOGLE_WEB_CLIENT_ID;
    delete process.env.GOOGLE_WEB_CLIENT_ID;
    try {
      await expect(verifyGoogleIdToken("t")).rejects.toThrow("google_client_id_not_configured");
    } finally {
      process.env.GOOGLE_WEB_CLIENT_ID = saved;
    }
  });
});
