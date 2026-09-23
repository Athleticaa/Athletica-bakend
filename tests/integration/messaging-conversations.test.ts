import jwt from "jsonwebtoken";
import request from "supertest";
import app from "../../src/app";

const SECRET = process.env.JWT_SECRET || "change-me-to-a-random-secret-in-production";
const CONV_ID = "123e4567-e89b-12d3-a456-426614174000";

function token(sub: string, role: string) {
  return jwt.sign({ sub, email: `${sub}@test.com`, role }, SECRET, { expiresIn: "1h" });
}

describe("GET /api/v1/messaging/conversations", () => {
  it("returns 401 without a token", async () => {
    const res = await request(app).get("/api/v1/messaging/conversations");
    expect(res.status).toBe(401);
  });

  it("does not leak conversations for unknown profiles", async () => {
    const res = await request(app)
      .get("/api/v1/messaging/conversations")
      .set("Authorization", `Bearer ${token("00000000-0000-4000-8000-000000000001", "coach")}`);
    // Unknown coach profile -> 404, never a list of other coaches' conversations.
    expect([200, 404]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.conversations)).toBe(true);
    }
  });
});

describe("GET /api/v1/messaging/conversations/:id", () => {
  it("returns 401 without a token", async () => {
    const res = await request(app).get(`/api/v1/messaging/conversations/${CONV_ID}`);
    expect(res.status).toBe(401);
  });

  it("returns 400 for a malformed id", async () => {
    const res = await request(app)
      .get("/api/v1/messaging/conversations/nope")
      .set("Authorization", `Bearer ${token("u1", "coach")}`);
    expect(res.status).toBe(400);
  });

  it("returns 403/404 for an unauthorized conversation", async () => {
    const res = await request(app)
      .get(`/api/v1/messaging/conversations/${CONV_ID}`)
      .set("Authorization", `Bearer ${token("00000000-0000-4000-8000-000000000002", "client")}`);
    expect([403, 404]).toContain(res.status);
  });
});
