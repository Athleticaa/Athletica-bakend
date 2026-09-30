import bcrypt from "bcryptjs";
import { OAuth2Client } from "google-auth-library";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import request from "supertest";
import app from "../../src/app";
import { GoogleTokenInvalidError, setGoogleAuthClientForTests } from "../../src/lib/google-auth";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const EMAILS = {
  client: "google-client-test@example.com",
  coach: "google-coach-test@example.com",
  link: "google-link-test@example.com",
  norole: "google-norole-test@example.com",
  guard: "google-guard-test@example.com",
};
const ALL = Object.values(EMAILS);

function fakeGoogleClient(payload: unknown, error?: unknown): OAuth2Client {
  return {
    verifyIdToken: async () => {
      if (error) throw error;
      return { getPayload: () => payload };
    },
  } as unknown as OAuth2Client;
}

function mockGoogleAccount(sub: string, email: string, name: unknown = "Test User") {
  setGoogleAuthClientForTests(
    fakeGoogleClient({ sub, email, name, email_verified: true, iss: "accounts.google.com" })
  );
}

function mockGoogleFailure() {
  setGoogleAuthClientForTests(fakeGoogleClient(null, new GoogleTokenInvalidError()));
}

async function cleanupGoogleUsers() {
  const scoped = { email: { in: ALL } };
  await prisma.checkin_answers.deleteMany({ where: { submission: { client: { user: scoped } } } }).catch(() => {});
  await prisma.checkin_submissions.deleteMany({ where: { client: { user: scoped } } }).catch(() => {});
  await prisma.checkin_questions.deleteMany({ where: { coach: { user: scoped } } });
  await prisma.refresh_tokens.deleteMany({ where: { user: scoped } });
  await prisma.verification_codes.deleteMany({ where: { user: scoped } });
  await prisma.password_reset_tokens.deleteMany({ where: { user: scoped } });
  await prisma.client_profiles.deleteMany({ where: { user: scoped } });
  await prisma.coach_profiles.deleteMany({ where: { user: scoped } });
  await prisma.users.deleteMany({ where: scoped });
}

beforeEach(() => {
  setGoogleAuthClientForTests(null);
});

beforeAll(async () => {
  await cleanupGoogleUsers();
});

afterAll(async () => {
  await cleanupGoogleUsers();
  await prisma.$disconnect();
});

describe("POST /api/v1/auth/google — new users (US1)", () => {
  it("creates a client user and returns the login-shaped session", async () => {
    mockGoogleAccount("google-sub-client-1", EMAILS.client, "John.Doe99!");

    const res = await request(app)
      .post("/api/v1/auth/google")
      .send({ idToken: "valid-token", role: "client" });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(EMAILS.client);
    expect(res.body.user.role).toBe("client");
    expect(res.body.user.email_verified).toBe(true);
    expect(res.body.user.username).toBe("John Doe");
    expect(res.body.token).toBeDefined();

    const me = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${res.body.token}`);
    expect(me.status).toBe(200);

    const row = await prisma.users.findUnique({ where: { email: EMAILS.client } });
    expect(row).toMatchObject({ provider: "google", google_sub: "google-sub-client-1", password: null });
    const profile = await prisma.client_profiles.findFirst({ where: { user_id: row!.id } });
    expect(profile).toBeDefined();
  });

  it("creates a coach user with default check-in questions", async () => {
    mockGoogleAccount("google-sub-coach-1", EMAILS.coach, "Coach Carter");

    const res = await request(app)
      .post("/api/v1/auth/google")
      .send({ idToken: "valid-token", role: "coach" });

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe("coach");

    const row = await prisma.users.findUnique({ where: { email: EMAILS.coach } });
    const coach = await prisma.coach_profiles.findFirst({ where: { user_id: row!.id } });
    expect(coach).toBeDefined();
    const questions = await prisma.checkin_questions.findMany({ where: { coach_id: coach!.id } });
    expect(questions.length).toBeGreaterThan(0);
  });

  it("returns 400 with machine-readable role_invalid when a new email has no role", async () => {
    mockGoogleAccount("google-sub-norole-1", EMAILS.norole);

    const res = await request(app).post("/api/v1/auth/google").send({ idToken: "valid-token" });

    expect(res.status).toBe(400);
    expect(res.body.details).toContain("role_invalid");
    expect(await prisma.users.findUnique({ where: { email: EMAILS.norole } })).toBeNull();
  });

  it("returns 400 with details for an invalid role value", async () => {
    const res = await request(app)
      .post("/api/v1/auth/google")
      .send({ idToken: "valid-token", role: "admin" });

    expect(res.status).toBe(400);
    expect(res.body.details).toBeDefined();
  });

  it("returns 401 and writes nothing for a forged token", async () => {
    mockGoogleFailure();

    const res = await request(app)
      .post("/api/v1/auth/google")
      .send({ idToken: "forged-token", role: "client" });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid token");
  });
});

describe("POST /api/v1/auth/google — returning users (US2)", () => {
  it("keeps the original role even when a different role is sent", async () => {
    mockGoogleAccount("google-sub-client-1", EMAILS.client);

    const res = await request(app)
      .post("/api/v1/auth/google")
      .send({ idToken: "fresh-token", role: "coach" });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(EMAILS.client);
    expect(res.body.user.role).toBe("client");
  });
});

describe("POST /api/v1/auth/google — auto-link (US3)", () => {
  beforeAll(async () => {
    const hash = await bcrypt.hash("password123", 12);
    await prisma.users.create({
      data: {
        username: "Link User",
        email: EMAILS.link,
        password: hash,
        role: "client",
        provider: "email",
        email_verified: true,
      },
    });
  });

  it("links the Google identity and preserves role + password login", async () => {
    mockGoogleAccount("google-sub-link-1", EMAILS.link, "Link User");

    const res = await request(app)
      .post("/api/v1/auth/google")
      .send({ idToken: "valid-token", role: "coach" });

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe("client");

    const row = await prisma.users.findUnique({ where: { email: EMAILS.link } });
    expect(row!.google_sub).toBe("google-sub-link-1");
    expect(row!.password).toBeTruthy();
    expect(await prisma.users.count({ where: { email: EMAILS.link } })).toBe(1);

    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: EMAILS.link, password: "password123" });
    expect(login.status).toBe(200);
  });
});

describe("Google-only password guards (US4)", () => {
  it("login with a password returns 401, not 500", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: EMAILS.client, password: "anything123" });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid email or password");
  });

  it("change-password returns a dedicated 400", async () => {
    mockGoogleAccount("google-sub-client-1", EMAILS.client);
    const session = await request(app)
      .post("/api/v1/auth/google")
      .send({ idToken: "fresh-token" });

    const res = await request(app)
      .post("/api/v1/auth/change-password")
      .set("Authorization", `Bearer ${session.body.token}`)
      .send({ old_password: "x", new_password: "newpassword123" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("This account uses Google sign-in and has no password");
  });
});
