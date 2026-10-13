import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import jwt from "jsonwebtoken";
import request from "supertest";
import app from "../../src/app";

const SECRET =
  process.env.JWT_SECRET || "change-me-to-a-random-secret-in-production";

function token(sub: string, role: string) {
  return jwt.sign({ sub, email: `${sub}@test.com`, role }, SECRET, {
    expiresIn: "1h",
  });
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

describe("GET /api/v1/notifications", () => {
  it("returns 401 without a token", async () => {
    const res = await request(app).get("/api/v1/notifications");
    expect(res.status).toBe(401);
  });

  it("returns 400 for a bad limit", async () => {
    const res = await request(app)
      .get("/api/v1/notifications?limit=999")
      .set("Authorization", `Bearer ${token("u1", "coach")}`);
    expect(res.status).toBe(400);
    expect(res.body.details).toContain("invalid_limit");
  });

  it("returns 400 for a bad cursor", async () => {
    const res = await request(app)
      .get("/api/v1/notifications?before=not-a-cursor")
      .set("Authorization", `Bearer ${token("u1", "client")}`);
    expect(res.status).toBe(400);
    expect(res.body.details).toContain("invalid_cursor");
  });
});

describe("GET /api/v1/notifications/unread-count", () => {
  it("returns 401 without a token", async () => {
    const res = await request(app).get("/api/v1/notifications/unread-count");
    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/v1/notifications/:id/read", () => {
  it("returns 401 without a token", async () => {
    const res = await request(app).patch(
      "/api/v1/notifications/11111111-1111-4111-8111-111111111111/read",
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 for a non-uuid id", async () => {
    const res = await request(app)
      .patch("/api/v1/notifications/not-a-uuid/read")
      .set("Authorization", `Bearer ${token("u1", "coach")}`);
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/v1/notifications/read-all", () => {
  it("returns 401 without a token", async () => {
    const res = await request(app).patch("/api/v1/notifications/read-all");
    expect(res.status).toBe(401);
  });
});

describe("notification created_at is correct UTC (timezone regression)", () => {
  const email = "notif-tz-test@example.com";
  let userId: string;

  beforeAll(async () => {
    await prisma.users.deleteMany({ where: { email } });
    const user = await prisma.users.create({
      data: { username: "notif_tz_test", email, role: "coach", provider: "email" },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.users.deleteMany({ where: { email } });
    await prisma.$disconnect();
  });

  it("returns created_at within a minute of now, not shifted by the local offset", async () => {
    await prisma.notifications.create({
      data: {
        recipient_user_id: userId,
        type: "coach_request",
        title: "TZ test",
        body: "TZ test body",
      },
    });

    const res = await request(app)
      .get("/api/v1/notifications")
      .set("Authorization", `Bearer ${token(userId, "coach")}`);

    expect(res.status).toBe(200);
    const items = res.body.data.notifications as Array<{ created_at: string }>;
    expect(items.length).toBeGreaterThan(0);

    const createdMs = new Date(items[0].created_at).getTime();
    expect(Number.isNaN(createdMs)).toBe(false);
    // A timezone-naive column read as local time would be off by hours here.
    expect(Math.abs(createdMs - Date.now())).toBeLessThan(60_000);
  });
});
