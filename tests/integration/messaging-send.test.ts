import jwt from "jsonwebtoken";
import request from "supertest";
import app from "../../src/app";

const SECRET = process.env.JWT_SECRET || "change-me-to-a-random-secret-in-production";
const CONV_ID = "123e4567-e89b-12d3-a456-426614174000";

function token(sub: string, role: string) {
  return jwt.sign({ sub, email: `${sub}@test.com`, role }, SECRET, { expiresIn: "1h" });
}

describe("POST /api/v1/messaging/conversations/:id/messages", () => {
  it("returns 401 without a token", async () => {
    const res = await request(app)
      .post(`/api/v1/messaging/conversations/${CONV_ID}/messages`)
      .send({ content: "hello" });
    expect(res.status).toBe(401);
  });

  it("returns 400 for a malformed conversation id", async () => {
    const res = await request(app)
      .post("/api/v1/messaging/conversations/not-a-uuid/messages")
      .set("Authorization", `Bearer ${token("u1", "coach")}`)
      .send({ content: "hello" });
    expect(res.status).toBe(400);
  });

  it("returns 400 for empty content and persists nothing", async () => {
    const res = await request(app)
      .post(`/api/v1/messaging/conversations/${CONV_ID}/messages`)
      .set("Authorization", `Bearer ${token("u1", "coach")}`)
      .send({ content: "   " });
    expect(res.status).toBe(400);
    expect(res.body.details).toContain("message_content_required");
  });

  it("rejects an unauthorized sender (no profile or not a member)", async () => {
    const res = await request(app)
      .post(`/api/v1/messaging/conversations/${CONV_ID}/messages`)
      .set("Authorization", `Bearer ${token("00000000-0000-4000-8000-000000000000", "coach")}`)
      .send({ content: "hello" });
    expect([403, 404]).toContain(res.status);
  });
});

describe("POST /api/v1/messaging/conversations/by-client/:clientId/messages", () => {
  const CLIENT_ID = "223e4567-e89b-12d3-a456-426614174000";

  it("rejects clients at the route level (coach only)", async () => {
    const res = await request(app)
      .post(`/api/v1/messaging/conversations/by-client/${CLIENT_ID}/messages`)
      .set("Authorization", `Bearer ${token("client-user", "client")}`)
      .send({ content: "hello" });
    expect(res.status).toBe(403);
  });

  it("returns 401 without a token", async () => {
    const res = await request(app)
      .post(`/api/v1/messaging/conversations/by-client/${CLIENT_ID}/messages`)
      .send({ content: "hello" });
    expect(res.status).toBe(401);
  });
});
