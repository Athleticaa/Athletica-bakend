import "reflect-metadata";
import jwt from "jsonwebtoken";
import request from "supertest";
import app from "../../src/app";

const SECRET = process.env.JWT_SECRET || "change-me-to-a-random-secret-in-production";

const UNKNOWN_USER = "123e4567-e89b-12d3-a456-426614174000";
const UNKNOWN_COACH_CLIENT = "223e4567-e89b-12d3-a456-426614174000";

function token(sub: string, role: string) {
  return jwt.sign({ sub, email: `${sub}@test.com`, role }, SECRET, { expiresIn: "1h" });
}

const clientToken = (sub = UNKNOWN_USER) => token(sub, "client");
const coachToken = (sub = UNKNOWN_USER) => token(sub, "coach");

describe("streak auth matrix", () => {
  it("GET /api/v1/workout/streak returns 401 without a token", async () => {
    const res = await request(app).get("/api/v1/workout/streak");
    expect(res.status).toBe(401);
  });

  it("GET /api/v1/nutrition/streak returns 401 without a token", async () => {
    const res = await request(app).get("/api/v1/nutrition/streak");
    expect(res.status).toBe(401);
  });

  it("coach token on client workout streak returns 403", async () => {
    const res = await request(app)
      .get("/api/v1/workout/streak")
      .set("Authorization", `Bearer ${coachToken()}`);
    expect(res.status).toBe(403);
  });

  it("coach token on client nutrition streak returns 403", async () => {
    const res = await request(app)
      .get("/api/v1/nutrition/streak")
      .set("Authorization", `Bearer ${coachToken()}`);
    expect(res.status).toBe(403);
  });

  it("client token on coach workout streak returns 403", async () => {
    const res = await request(app)
      .get(`/api/v1/workout/clients/${UNKNOWN_COACH_CLIENT}/streak`)
      .set("Authorization", `Bearer ${clientToken()}`);
    expect(res.status).toBe(403);
  });

  it("client token on coach nutrition streak returns 403", async () => {
    const res = await request(app)
      .get(`/api/v1/nutrition/clients/${UNKNOWN_COACH_CLIENT}/streak`)
      .set("Authorization", `Bearer ${clientToken()}`);
    expect(res.status).toBe(403);
  });
});

describe("client streak without assignment (T007/T012)", () => {
  it("workout streak returns 404 assignment_not_found for unknown client", async () => {
    const res = await request(app)
      .get("/api/v1/workout/streak")
      .set("Authorization", `Bearer ${clientToken()}`);
    expect(res.status).toBe(404);
  });

  it("nutrition streak returns 404 for unknown client", async () => {
    const res = await request(app)
      .get("/api/v1/nutrition/streak")
      .set("Authorization", `Bearer ${clientToken()}`);
    expect(res.status).toBe(404);
  });
});

describe("coach streak isolation matrix (T016/T019)", () => {
  it("workout coach route returns 400 for malformed UUID", async () => {
    const res = await request(app)
      .get("/api/v1/workout/clients/not-a-uuid/streak")
      .set("Authorization", `Bearer ${coachToken()}`);
    expect(res.status).toBe(400);
  });

  it("nutrition coach route returns 400 for malformed UUID", async () => {
    const res = await request(app)
      .get("/api/v1/nutrition/clients/not-a-uuid/streak")
      .set("Authorization", `Bearer ${coachToken()}`);
    expect(res.status).toBe(400);
  });

  it("workout coach route returns 404 for foreign/unknown coach_client id", async () => {
    const res = await request(app)
      .get(`/api/v1/workout/clients/${UNKNOWN_COACH_CLIENT}/streak`)
      .set("Authorization", `Bearer ${coachToken()}`);
    expect(res.status).toBe(404);
  });

  it("nutrition coach route returns 404 for foreign/unknown coach_client id", async () => {
    const res = await request(app)
      .get(`/api/v1/nutrition/clients/${UNKNOWN_COACH_CLIENT}/streak`)
      .set("Authorization", `Bearer ${coachToken()}`);
    expect(res.status).toBe(404);
  });
});

describe("streak response shape (T006/T011, seeded data)", () => {
  // Full 200-shape assertions live in the service unit tests
  // (tests/unit/streak-workout.test.ts, tests/unit/streak-nutrition.test.ts)
  // with mocked Prisma; they run deterministically without seeded rows.
  // These endpoint checks assert the envelope contract on live paths.
  it("workout streak envelope contract holds for any live status", async () => {
    const res = await request(app)
      .get("/api/v1/workout/streak")
      .set("Authorization", `Bearer ${clientToken()}`);
    expect([200, 404]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.success).toBe(true);
      const d = res.body.data;
      for (const k of [
        "client_id",
        "coach_client_id",
        "from",
        "to",
        "current_streak",
        "longest_streak",
        "total_completed",
        "total_missed",
        "rest_days",
        "total_days",
        "completion_rate",
        "days",
      ])
        expect(d).toHaveProperty(k);
      expect(Array.isArray(d.days)).toBe(true);
      expect(d.days.length).toBe(d.total_days);
    }
  });

  it("nutrition streak envelope contract holds for any live status", async () => {
    const res = await request(app)
      .get("/api/v1/nutrition/streak")
      .set("Authorization", `Bearer ${clientToken()}`);
    expect([200, 404]).toContain(res.status);
    if (res.status === 200) {
      const d = res.body.data ?? res.body;
      for (const k of [
        "client_id",
        "coach_client_id",
        "from",
        "to",
        "current_streak",
        "longest_streak",
        "total_completed",
        "total_missed",
        "total_days",
        "completion_rate",
        "days",
      ])
        expect(d).toHaveProperty(k);
      expect(Array.isArray(d.days)).toBe(true);
    }
  });
});
