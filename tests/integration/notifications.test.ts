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
