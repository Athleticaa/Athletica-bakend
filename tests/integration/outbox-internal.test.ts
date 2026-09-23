import request from "supertest";
import app from "../../src/app";

describe("POST /api/v1/internal/outbox/process", () => {
  it("rejects missing secrets", async () => {
    const res = await request(app).post("/api/v1/internal/outbox/process").send({});
    expect([401, 500]).toContain(res.status);
  });

  it("rejects an invalid secret", async () => {
    const res = await request(app)
      .post("/api/v1/internal/outbox/process")
      .set("X-Cron-Secret", "wrong-secret")
      .send({});
    expect([401, 500]).toContain(res.status);
  });

  it("processes a bounded batch with the valid secret", async () => {
    const secret = process.env.OUTBOX_CRON_SECRET;
    if (!secret) {
      // Misconfigured env — endpoint must report it instead of crashing.
      const res = await request(app).post("/api/v1/internal/outbox/process").send({});
      expect(res.status).toBe(500);
      return;
    }
    const res = await request(app)
      .post("/api/v1/internal/outbox/process")
      .set("X-Cron-Secret", secret)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.data.claimed).toBe("number");
  });
});
