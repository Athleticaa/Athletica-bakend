import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import jwt from "jsonwebtoken";
import request from "supertest";
import app from "../../src/app";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const TEST_EMAILS = ["coach-test@example.com", "client-test@example.com", "invalid-role@example.com", "username-dup@example.com", "delete-account-test@example.com"];

beforeAll(async () => {
  const scoped = { email: { in: TEST_EMAILS } };
  await prisma.refresh_tokens.deleteMany({ where: { user: scoped } });
  await prisma.verification_codes.deleteMany({ where: { user: scoped } });
  await prisma.password_reset_tokens.deleteMany({ where: { user: scoped } });
  await prisma.coach_requests.deleteMany({ where: { client: { user: scoped } } });
  await prisma.coach_clients.deleteMany({ where: { client: { user: scoped } } });
  await prisma.client_profiles.deleteMany({ where: { user: scoped } });
  await prisma.coach_profiles.deleteMany({ where: { user: scoped } });
  await prisma.users.deleteMany({ where: scoped });
});

describe("POST /auth/signup", () => {
  it("should create a coach user and return 200 with message", async () => {
    const res = await request(app)
      .post("/api/v1/auth/signup")
      .send({
        username: "johndoe",
        email: "coach-test@example.com",
        password: "password123",
        role: "coach",
      });

    expect(res.status).toBe(200);
    expect(res.body.message).toBeDefined();
  });

  it("should create a client user and return 200 with message", async () => {
    const res = await request(app)
      .post("/api/v1/auth/signup")
      .send({
        username: "janesmith",
        email: "client-test@example.com",
        password: "password123",
        role: "client",
      });

    expect(res.status).toBe(200);
    expect(res.body.message).toBeDefined();
  });

  it("should return 400 for invalid role", async () => {
    const res = await request(app)
      .post("/api/v1/auth/signup")
      .send({
        username: "testuser",
        email: "invalid-role@example.com",
        password: "password123",
        role: "admin",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
  });

  it("should return 409 for duplicate email", async () => {
    const res = await request(app)
      .post("/api/v1/auth/signup")
      .send({
        username: "johndoe",
        email: "coach-test@example.com",
        password: "password123",
        role: "coach",
      });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("Email already registered");
  });

  it("should allow duplicate usernames when emails differ", async () => {
    const res = await request(app)
      .post("/api/v1/auth/signup")
      .send({
        username: "johndoe",
        email: "username-dup@example.com",
        password: "password123",
        role: "coach",
      });

    expect(res.status).toBe(200);
    expect(res.body.message).toBeTruthy();
  });
});

describe("POST /auth/login", () => {
  beforeAll(async () => {
    await prisma.users.updateMany({ where: { email: { in: TEST_EMAILS } }, data: { email_verified: true } });
  });

  it("should login successfully and return 200 with token", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email: "coach-test@example.com",
        password: "password123",
      });

    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.token).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    expect(res.body.user.email).toBe("coach-test@example.com");
  });

  it("should return 401 for wrong password", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email: "coach-test@example.com",
        password: "wrongpassword",
      });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid email or password");
  });

  it("should return 401 for nonexistent email", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email: "nonexistent@example.com",
        password: "password123",
      });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid email or password");
  });

  it("should return 400 when email or password is missing", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "test@example.com" });

    expect(res.status).toBe(400);
  });
});

describe("POST /auth/delete-account", () => {
  beforeAll(async () => {
    const response = await request(app).post("/api/v1/auth/signup").send({
      username: "deleteaccount",
      email: "delete-account-test@example.com",
      password: "password123",
      role: "client",
    });
    expect(response.status).toBe(200);
    await prisma.users.update({
      where: { email: "delete-account-test@example.com" },
      data: { email_verified: true },
    });
  });

  it("soft-deletes, revokes sessions, preserves data, and allows login recovery", async () => {
    const login = await request(app).post("/api/v1/auth/login").send({
      email: "delete-account-test@example.com",
      password: "password123",
    });
    expect(login.status).toBe(200);

    const response = await request(app).post("/api/v1/auth/delete-account").send({
      email: "delete-account-test@example.com",
      password: "password123",
    });
    expect(response.status).toBe(200);

    const deleted = await prisma.users.findUnique({ where: { email: "delete-account-test@example.com" } });
    expect(deleted?.deleted_at).toBeInstanceOf(Date);
    expect(deleted?.deleted_at?.toISOString()).toMatch(/Z$/);
    expect(await prisma.client_profiles.count({ where: { user_id: deleted!.id } })).toBe(1);
    expect(await prisma.refresh_tokens.count({ where: { user_id: deleted!.id } })).toBe(0);

    const protectedResponse = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${login.body.token}`);
    expect(protectedResponse.status).toBe(401);

    const refreshResponse = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: login.body.refreshToken });
    expect(refreshResponse.status).toBe(401);

    const restoredLogin = await request(app).post("/api/v1/auth/login").send({
      email: "delete-account-test@example.com",
      password: "password123",
    });
    expect(restoredLogin.status).toBe(200);
    const restored = await prisma.users.findUnique({ where: { email: "delete-account-test@example.com" } });
    expect(restored?.deleted_at).toBeNull();
  });

  it("rejects invalid credentials and does not delete the account", async () => {
    const response = await request(app).post("/api/v1/auth/delete-account").send({
      email: "delete-account-test@example.com",
      password: "wrongpassword",
    });
    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Invalid email or password");
    expect((await prisma.users.findUnique({ where: { email: "delete-account-test@example.com" } }))?.deleted_at).toBeNull();
  });

  it("does not extend the recovery window when deletion is repeated", async () => {
    const deletedAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    await prisma.users.update({ where: { email: "delete-account-test@example.com" }, data: { deleted_at: deletedAt } });
    const response = await request(app).post("/api/v1/auth/delete-account").send({
      email: "delete-account-test@example.com",
      password: "password123",
    });
    expect(response.status).toBe(401);
    expect((await prisma.users.findUnique({ where: { email: "delete-account-test@example.com" } }))?.deleted_at).toEqual(deletedAt);
    await prisma.users.update({ where: { email: "delete-account-test@example.com" }, data: { deleted_at: null } });
  });

  it("does not restore after 30 days", async () => {
    const expiredAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000 - 1000);
    await prisma.users.update({ where: { email: "delete-account-test@example.com" }, data: { deleted_at: expiredAt } });
    const response = await request(app).post("/api/v1/auth/login").send({
      email: "delete-account-test@example.com",
      password: "password123",
    });
    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Account recovery period has expired");
    expect((await prisma.users.findUnique({ where: { email: "delete-account-test@example.com" } }))?.deleted_at).toEqual(expiredAt);

    await prisma.users.update({ where: { email: "delete-account-test@example.com" }, data: { deleted_at: null } });
  });
});

describe("POST /auth/refresh", () => {
  const loginAndGetRefreshToken = async (): Promise<string> => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "coach-test@example.com", password: "password123" });
    return res.body.refreshToken;
  };

  it("should rotate the refresh token and return a new access token", async () => {
    const first = await loginAndGetRefreshToken();

    const res = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: first });

    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.token).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    expect(res.body.refreshToken).not.toBe(first);

    // The rotated-away token must be rejected.
    const replay = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: first });

    expect(replay.status).toBe(401);
    expect(replay.body.error).toBe("Invalid or expired refresh token");

    // The freshly issued token remains usable.
    const second = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: res.body.refreshToken });

    expect(second.status).toBe(200);
    expect(second.body.token).toBeDefined();
  });

  it("should return 401 for an invalid refresh token", async () => {
    const res = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: "deadbeef".repeat(8) });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid or expired refresh token");
  });

  it("should return 400 when refreshToken is missing", async () => {
    const res = await request(app).post("/api/v1/auth/refresh").send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
  });
});

describe("GET /auth/me (authenticated route)", () => {
  let coachToken: string;
  let clientToken: string;

  beforeAll(async () => {
    const coachRes = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "coach-test@example.com", password: "password123" });
    coachToken = coachRes.body.token;

    const clientRes = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "client-test@example.com", password: "password123" });
    clientToken = clientRes.body.token;
  });

  it("should return user info for authenticated coach", async () => {
    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${coachToken}`);

    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
  });

  it("should return 401 without token", async () => {
    const res = await request(app).get("/api/v1/auth/me");

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Authentication required");
  });

  it("should return 401 with invalid-token message for an invalid token", async () => {
    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", "Bearer invalidtoken");

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid token");
  });

  it("should return 401 with expired-token message for an expired token", async () => {
    const secret = process.env.JWT_SECRET || "change-me-to-a-random-secret-in-production";
    const expiredToken = jwt.sign(
      { sub: "user", email: "test@example.com", role: "coach" },
      secret,
      { expiresIn: "-10s" }
    );

    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${expiredToken}`);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Token has expired");
  });
});

describe("POST /auth/reset-password", () => {
  it("should return 200 for existing email", async () => {
    const res = await request(app)
      .post("/api/v1/auth/reset-password")
      .send({ email: "coach-test@example.com" });

    expect(res.status).toBe(200);
    expect(res.body.message).toBeDefined();
  });

  it("should return 200 for nonexistent email (no enumeration)", async () => {
    const res = await request(app)
      .post("/api/v1/auth/reset-password")
      .send({ email: "doesnotexist@example.com" });

    expect(res.status).toBe(200);
  });
});

describe("POST /auth/reset-password/confirm", () => {
  it("should return 400 for invalid code", async () => {
    const res = await request(app)
      .post("/api/v1/auth/reset-password/confirm")
      .send({ email: "coach-test@example.com", code: "000000", password: "newpassword123" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid or expired reset token");
  });
});

describe("POST /auth/verify-email", () => {
  it("should return 400 for invalid code", async () => {
    const res = await request(app)
      .post("/api/v1/auth/verify-email")
      .send({ email: "coach-test@example.com", code: "000000" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid or expired verification code");
  });

  it("should return 400 when email is missing", async () => {
    const res = await request(app)
      .post("/api/v1/auth/verify-email")
      .send({ code: "123456" });

    expect(res.status).toBe(400);
  });
});

describe("POST /auth/resend-verification", () => {
  it("should return 200 for existing email", async () => {
    const res = await request(app)
      .post("/api/v1/auth/resend-verification")
      .send({ email: "coach-test@example.com" });

    expect(res.status).toBe(200);
  });

  it("should return 200 for nonexistent email (no enumeration)", async () => {
    const res = await request(app)
      .post("/api/v1/auth/resend-verification")
      .send({ email: "doesnotexist@example.com" });

    expect(res.status).toBe(200);
  });

  it("should return 400 when email is missing", async () => {
    const res = await request(app)
      .post("/api/v1/auth/resend-verification")
      .send({});

    expect(res.status).toBe(400);
  });
});

describe("POST /auth/change-password", () => {
  let coachToken: string;

  beforeAll(async () => {
    const coachRes = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "coach-test@example.com", password: "password123" });
    coachToken = coachRes.body.token;
  });

  it("should change password successfully with valid old password", async () => {
    const res = await request(app)
      .post("/api/v1/auth/change-password")
      .set("Authorization", `Bearer ${coachToken}`)
      .send({ old_password: "password123", new_password: "newpass1234" });

    expect(res.status).toBe(200);
    expect(res.body.message).toBeDefined();

    // revert
    const revertRes = await request(app)
      .post("/api/v1/auth/change-password")
      .set("Authorization", `Bearer ${coachToken}`)
      .send({ old_password: "newpass1234", new_password: "password123" });

    expect(revertRes.status).toBe(200);
  });

  it("should return 400 for wrong old password", async () => {
    const res = await request(app)
      .post("/api/v1/auth/change-password")
      .set("Authorization", `Bearer ${coachToken}`)
      .send({ old_password: "wrongpassword", new_password: "newpass1234" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("old password is incorrect");
  });

  it("should return 401 without auth", async () => {
    const res = await request(app)
      .post("/api/v1/auth/change-password")
      .send({ old_password: "password123", new_password: "newpass1234" });

    expect(res.status).toBe(401);
  });
});
