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

const TOKEN = "e".repeat(150);
const DEVICE_ID = "123e4567-e89b-12d3-a456-426614174000";
// Valid-UUID sub with no device row: exercises the genuine P2025 not-found
// path (a non-UUID sub fails driver input validation before lookup).
const UNKNOWN_USER = "00000000-0000-4000-8000-000000000001";

describe("POST /api/v1/devices", () => {
  it("returns 401 without a token", async () => {
    const res = await request(app)
      .post("/api/v1/devices")
      .send({ fcm_token: TOKEN, platform: "android", device_id: DEVICE_ID });
    expect(res.status).toBe(401);
  });

  it("returns 400 for an invalid platform", async () => {
    const res = await request(app)
      .post("/api/v1/devices")
      .set("Authorization", `Bearer ${token("u1", "coach")}`)
      .send({ fcm_token: TOKEN, platform: "windows", device_id: DEVICE_ID });
    expect(res.status).toBe(400);
  });

  it("returns 400 for a short token", async () => {
    const res = await request(app)
      .post("/api/v1/devices")
      .set("Authorization", `Bearer ${token("u1", "coach")}`)
      .send({ fcm_token: "short", platform: "ios", device_id: DEVICE_ID });
    expect(res.status).toBe(400);
  });

  it("returns 400 for a non-uuid device_id", async () => {
    const res = await request(app)
      .post("/api/v1/devices")
      .set("Authorization", `Bearer ${token("u1", "coach")}`)
      .send({ fcm_token: TOKEN, platform: "web", device_id: "not-a-uuid" });
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/v1/devices", () => {
  it("returns 401 without a token", async () => {
    const res = await request(app)
      .delete("/api/v1/devices")
      .send({ device_id: DEVICE_ID });
    expect(res.status).toBe(401);
  });

  it("returns 400 with no identifier", async () => {
    const res = await request(app)
      .delete("/api/v1/devices")
      .set("Authorization", `Bearer ${token("u1", "coach")}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it("returns 400 for a malformed device_id even with a valid token", async () => {
    const res = await request(app)
      .delete("/api/v1/devices")
      .set("Authorization", `Bearer ${token("u1", "coach")}`)
      .send({ device_id: "not-a-uuid", fcm_token: TOKEN });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/v1/devices/heartbeat", () => {
  it("returns 401 without a token", async () => {
    const res = await request(app)
      .post("/api/v1/devices/heartbeat")
      .send({ device_id: DEVICE_ID });
    expect(res.status).toBe(401);
  });

  it("returns 404 for an unknown device", async () => {
    const res = await request(app)
      .post("/api/v1/devices/heartbeat")
      .set("Authorization", `Bearer ${token(UNKNOWN_USER, "coach")}`)
      .send({ device_id: DEVICE_ID });
    // No row exists for this user+device; update throws → 404. No write occurs.
    expect(res.status).toBe(404);
  });
});
