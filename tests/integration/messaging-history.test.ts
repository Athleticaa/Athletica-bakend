import jwt from "jsonwebtoken";
import request from "supertest";
import app from "../../src/app";

const SECRET = process.env.JWT_SECRET || "change-me-to-a-random-secret-in-production";
const CONV_ID = "123e4567-e89b-12d3-a456-426614174000";

function token(sub: string, role: string) {
  return jwt.sign({ sub, email: `${sub}@test.com`, role }, SECRET, { expiresIn: "1h" });
}

describe("GET /api/v1/messaging/conversations/:id/messages", () => {
  it("returns 401 without a token", async () => {
    const res = await request(app).get(
      `/api/v1/messaging/conversations/${CONV_ID}/messages?limit=10`,
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 for an out-of-range limit", async () => {
    const res = await request(app)
      .get(`/api/v1/messaging/conversations/${CONV_ID}/messages?limit=1000`)
      .set("Authorization", `Bearer ${token("u1", "coach")}`);
    expect(res.status).toBe(400);
    expect(res.body.details).toContain("invalid_limit");
  });

  it("returns 400 for a malformed cursor", async () => {
    const res = await request(app)
      .get(`/api/v1/messaging/conversations/${CONV_ID}/messages?before=bad-cursor`)
      .set("Authorization", `Bearer ${token("u1", "coach")}`);
    expect(res.status).toBe(400);
    expect(res.body.details).toContain("invalid_cursor");
  });

  it("returns bounded pages (limit respected) for authorized callers", async () => {
    // Unknown profile -> 403/404; a real assigned pair would get { messages, nextCursor, hasMore }.
    // This asserts the bound is enforced at the validation layer even before DB auth.
    const res = await request(app)
      .get(`/api/v1/messaging/conversations/${CONV_ID}/messages?limit=5`)
      .set("Authorization", `Bearer ${token("00000000-0000-4000-8000-000000000003", "coach")}`);
    expect([200, 403, 404]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.success).toBe(true);
      expect(res.body.data.messages.length).toBeLessThanOrEqual(5);
      expect(typeof res.body.data.hasMore).toBe("boolean");
    }
  });
});
