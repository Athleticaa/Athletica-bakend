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

const DEVICE_ID = "123e4567-e89b-12d3-a456-426614174000";
const UNKNOWN_USER = "00000000-0000-4000-8000-000000000000";

describe("POST /api/v1/auth/logout (device cleanup)", () => {
  it("returns 401 without a token", async () => {
    const res = await request(app).post("/api/v1/auth/logout").send({});
    expect(res.status).toBe(401);
  });

  it("returns 200 with no identifiers (legacy: clears all user devices)", async () => {
    const res = await request(app)
      .post("/api/v1/auth/logout")
      .set("Authorization", `Bearer ${token(UNKNOWN_USER, "coach")}`)
      .send({});
    // deleteMany is a no-op for unknown users — still 200.
    expect(res.status).toBe(200);
  });

  it("returns 200 with a valid device_id", async () => {
    const res = await request(app)
      .post("/api/v1/auth/logout")
      .set("Authorization", `Bearer ${token(UNKNOWN_USER, "coach")}`)
      .send({ device_id: DEVICE_ID });
    expect(res.status).toBe(200);
  });

  it("returns 400 for a malformed device_id", async () => {
    const res = await request(app)
      .post("/api/v1/auth/logout")
      .set("Authorization", `Bearer ${token(UNKNOWN_USER, "coach")}`)
      .send({ device_id: "not-a-uuid" });
    expect(res.status).toBe(400);
  });

  it("returns 400 for an empty fcm_token", async () => {
    const res = await request(app)
      .post("/api/v1/auth/logout")
      .set("Authorization", `Bearer ${token(UNKNOWN_USER, "coach")}`)
      .send({ fcm_token: "   " });
    expect(res.status).toBe(400);
  });

  it("returns 400 for a truncated fcm_token (same bounds as registration)", async () => {
    const res = await request(app)
      .post("/api/v1/auth/logout")
      .set("Authorization", `Bearer ${token(UNKNOWN_USER, "coach")}`)
      .send({ fcm_token: "short-corrupt-token" });
    expect(res.status).toBe(400);
  });
});
