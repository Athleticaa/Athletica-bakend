import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import request from "supertest";
import app from "../../src/app";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const EMAIL_PREFIX = "ca-";
let emailCounter = 0;

async function signupAndLogin(role: "coach" | "client", email?: string) {
  const usedEmail = email || `${EMAIL_PREFIX}${role}-${Date.now()}-${emailCounter++}@example.com`;
  const signupRes = await request(app)
    .post("/api/v1/auth/signup")
    .send({
      first_name: "Test",
      last_name: role === "coach" ? "Coach" : "Client",
      email: usedEmail,
      password: "password123",
      role,
    });
  if (signupRes.status !== 200) {
    throw new Error(`signup failed for ${usedEmail}: ${JSON.stringify(signupRes.body)}`);
  }

  await prisma.users.update({
    where: { email: usedEmail },
    data: { email_verified: true },
  });

  const loginRes = await request(app)
    .post("/api/v1/auth/login")
    .send({ email: usedEmail, password: "password123" });
  if (loginRes.status !== 200) {
    throw new Error(`login failed for ${usedEmail}: ${JSON.stringify(loginRes.body)}`);
  }

  const user = loginRes.body.user;
  return { token: loginRes.body.token, userId: user.id, email: usedEmail };
}

beforeAll(async () => {
  const scoped = { email: { startsWith: EMAIL_PREFIX } };

  await prisma.refresh_tokens.deleteMany({ where: { user: scoped } });
  await prisma.verification_codes.deleteMany({ where: { user: scoped } });
  await prisma.password_reset_tokens.deleteMany({ where: { user: scoped } });
  await prisma.coach_requests.deleteMany({ where: { OR: [{ client: { user: scoped } }, { coach: { user: scoped } }] } });
  await prisma.coach_clients.deleteMany({ where: { OR: [{ client: { user: scoped } }, { coach: { user: scoped } }] } });
  await prisma.client_answers.deleteMany({ where: { client: { user: scoped } } });
  await prisma.client_profiles.deleteMany({ where: { user: scoped } });
  await prisma.coach_profiles.deleteMany({ where: { user: scoped } });
  await prisma.users.deleteMany({ where: scoped });
}, 60000);

afterAll(async () => {
  await prisma.$disconnect();
});

export { prisma, signupAndLogin };

describe("POST /coach/invite", () => {
  let coach: { token: string; userId: string };
  let client: { token: string; userId: string };

  beforeAll(async () => {
    coach = await signupAndLogin("coach");
    client = await signupAndLogin("client");
  }, 60000);

  it("returns 201 with token, invite_url, and expires_at", async () => {
    const res = await request(app)
      .post("/api/v1/coach/invite")
      .set("Authorization", `Bearer ${coach.token}`);

    expect(res.status).toBe(201);
    expect(res.body.token).toBeDefined();
    expect(res.body.invite_url).toBeDefined();
    expect(res.body.invite_url).toContain(`/invite/${res.body.token}`);
    expect(res.body.expires_at).toBeDefined();
  });

  it("returns 200 with the SAME token when called again", async () => {
    const fresh = await signupAndLogin("coach");
    const first = await request(app)
      .post("/api/v1/coach/invite")
      .set("Authorization", `Bearer ${fresh.token}`);
    const second = await request(app)
      .post("/api/v1/coach/invite")
      .set("Authorization", `Bearer ${fresh.token}`);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.token).toBe(first.body.token);
  });

  it("returns 403 for a client token", async () => {
    const res = await request(app)
      .post("/api/v1/coach/invite")
      .set("Authorization", `Bearer ${client.token}`);

    expect(res.status).toBe(403);
  });

  it("returns 401 unauthenticated", async () => {
    const res = await request(app).post("/api/v1/coach/invite");

    expect(res.status).toBe(401);
  });
});

describe("DELETE /coach/invite", () => {
  let coach: { token: string };

  beforeAll(async () => {
    coach = await signupAndLogin("coach");
  }, 60000);

  it("revokes the active invite and returns 200", async () => {
    const createRes = await request(app)
      .post("/api/v1/coach/invite")
      .set("Authorization", `Bearer ${coach.token}`);
    expect(createRes.status).toBe(201);

    const revokeRes = await request(app)
      .delete("/api/v1/coach/invite")
      .set("Authorization", `Bearer ${coach.token}`);

    expect(revokeRes.status).toBe(200);
    expect(revokeRes.body.message).toBeDefined();

    const profile = await prisma.coach_profiles.findFirst({
      where: { user: { id: coach.userId } },
    });
    expect(profile?.active_invite_token).toBeNull();
    expect(profile?.active_invite_token_expires_at).toBeNull();
  });

  it("returns 404 when no active invite exists", async () => {
    const coach2 = await signupAndLogin("coach");
    const res = await request(app)
      .delete("/api/v1/coach/invite")
      .set("Authorization", `Bearer ${coach2.token}`);

    expect(res.status).toBe(404);
  });

  it("returns 403 for a client token", async () => {
    const client = await signupAndLogin("client");
    const res = await request(app)
      .delete("/api/v1/coach/invite")
      .set("Authorization", `Bearer ${client.token}`);

    expect(res.status).toBe(403);
  });
});

describe("POST /coach-requests", () => {
  let coach: { token: string; userId: string };
  let client: { token: string; userId: string };
  let client2: { token: string; userId: string };
  let inviteToken: string;

  async function createInvite(token: string) {
    const res = await request(app)
      .post("/api/v1/coach/invite")
      .set("Authorization", `Bearer ${token}`);
    return res.body.token;
  }

  async function getProfileIds() {
    const coachProfile = await prisma.coach_profiles.findFirst({ where: { user: { id: coach.userId } } });
    const clientProfile = await prisma.client_profiles.findFirst({ where: { user: { id: client.userId } } });
    return { coachProfile, clientProfile };
  }

  beforeAll(async () => {
    coach = await signupAndLogin("coach");
    client = await signupAndLogin("client");
    client2 = await signupAndLogin("client");
    inviteToken = await createInvite(coach.token);
  }, 60000);

  it("returns 201 with pending status for a valid token", async () => {
    const res = await request(app)
      .post("/api/v1/coach-requests")
      .set("Authorization", `Bearer ${client.token}`)
      .send({ token: inviteToken });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("pending");
    expect(res.body.coach_id).toBeDefined();
    expect(res.body.client_id).toBeDefined();

    const { coachProfile, clientProfile } = await getProfileIds();
    const row = await prisma.coach_requests.findUnique({
      where: { coach_id_client_id: { coach_id: coachProfile!.id, client_id: clientProfile!.id } },
    });
    expect(row?.status).toBe("pending");
  });

  it("returns 400 for an invalid token", async () => {
    const res = await request(app)
      .post("/api/v1/coach-requests")
      .set("Authorization", `Bearer ${client.token}`)
      .send({ token: "not-a-real-token" });

    expect(res.status).toBe(400);
  });

  it("returns 400 for a revoked token", async () => {
    const revokeCoach = await signupAndLogin("coach");
    const revokeClient = await signupAndLogin("client");
    const token = await createInvite(revokeCoach.token);

    const revoked = await request(app)
      .delete("/api/v1/coach/invite")
      .set("Authorization", `Bearer ${revokeCoach.token}`);
    expect(revoked.status).toBe(200);

    const res = await request(app)
      .post("/api/v1/coach-requests")
      .set("Authorization", `Bearer ${revokeClient.token}`)
      .send({ token });

    expect(res.status).toBe(400);
  });

  it("returns 403 for a coach token (client role required)", async () => {
    const res = await request(app)
      .post("/api/v1/coach-requests")
      .set("Authorization", `Bearer ${coach.token}`)
      .send({ token: inviteToken });

    expect(res.status).toBe(403);
  });

  it("returns 401 unauthenticated", async () => {
    const res = await request(app)
      .post("/api/v1/coach-requests")
      .send({ token: inviteToken });

    expect(res.status).toBe(401);
  });

  it("returns 409 for a duplicate pending request", async () => {
    const res = await request(app)
      .post("/api/v1/coach-requests")
      .set("Authorization", `Bearer ${client.token}`)
      .send({ token: inviteToken });

    expect(res.status).toBe(409);
  });

  it("allows two different clients to use the same link (both 201)", async () => {
    const res2 = await request(app)
      .post("/api/v1/coach-requests")
      .set("Authorization", `Bearer ${client2.token}`)
      .send({ token: inviteToken });

    expect(res2.status).toBe(201);
    expect(res2.body.status).toBe("pending");
  });

  it("returns 400 when resubmitting within the 5-minute cooldown", async () => {
    const cooldownCoach = await signupAndLogin("coach");
    const cooldownClient = await signupAndLogin("client");
    const token = await createInvite(cooldownCoach.token);

    const firstRes = await request(app)
      .post("/api/v1/coach-requests")
      .set("Authorization", `Bearer ${cooldownClient.token}`)
      .send({ token });
    expect(firstRes.status).toBe(201);

    const coachProfile = await prisma.coach_profiles.findFirst({
      where: { user: { id: cooldownCoach.userId } },
    });
    const clientProfile = await prisma.client_profiles.findFirst({
      where: { user: { id: cooldownClient.userId } },
    });
    await prisma.coach_requests.update({
      where: {
        coach_id_client_id: { coach_id: coachProfile!.id, client_id: clientProfile!.id },
      },
      data: { status: "rejected", rejected_at: new Date(Date.now() - 60 * 1000) },
    });

    const resubmit = await request(app)
      .post("/api/v1/coach-requests")
      .set("Authorization", `Bearer ${cooldownClient.token}`)
      .send({ token });

    expect(resubmit.status).toBe(400);
  }, 30000);

  it("resets a rejected request after the 5-minute cooldown (200, rejected_at cleared)", async () => {
    const resetCoach = await signupAndLogin("coach");
    const resetClient = await signupAndLogin("client");
    const token = await createInvite(resetCoach.token);

    const firstRes = await request(app)
      .post("/api/v1/coach-requests")
      .set("Authorization", `Bearer ${resetClient.token}`)
      .send({ token });
    expect(firstRes.status).toBe(201);

    const coachProfile = await prisma.coach_profiles.findFirst({
      where: { user: { id: resetCoach.userId } },
    });
    const clientProfile = await prisma.client_profiles.findFirst({
      where: { user: { id: resetClient.userId } },
    });
    await prisma.coach_requests.update({
      where: {
        coach_id_client_id: { coach_id: coachProfile!.id, client_id: clientProfile!.id },
      },
      data: { status: "rejected", rejected_at: new Date(Date.now() - 6 * 60 * 1000) },
    });

    const resubmit = await request(app)
      .post("/api/v1/coach-requests")
      .set("Authorization", `Bearer ${resetClient.token}`)
      .send({ token });

    expect(resubmit.status).toBe(200);
    expect(resubmit.body.status).toBe("pending");
    expect(resubmit.body.rejected_at).toBeNull();
  }, 30000);

  it("resets an accepted request to pending after the client left (200)", async () => {
    const rejoinCoach = await signupAndLogin("coach");
    const rejoinClient = await signupAndLogin("client");
    const token = await createInvite(rejoinCoach.token);

    const submitRes = await request(app)
      .post("/api/v1/coach-requests")
      .set("Authorization", `Bearer ${rejoinClient.token}`)
      .send({ token });
    expect(submitRes.status).toBe(201);

    const coachProfile = await prisma.coach_profiles.findFirst({
      where: { user: { id: rejoinCoach.userId } },
    });
    const clientProfile = await prisma.client_profiles.findFirst({
      where: { user: { id: rejoinClient.userId } },
    });
    const requestId = submitRes.body.id;

    const acceptRes = await request(app)
      .post(`/api/v1/coach/requests/${requestId}/accept`)
      .set("Authorization", `Bearer ${rejoinCoach.token}`);
    expect(acceptRes.status).toBe(200);

    const leaveRes = await request(app)
      .post("/api/v1/client/leave-coach")
      .set("Authorization", `Bearer ${rejoinClient.token}`);
    expect(leaveRes.status).toBe(200);

    const resubmit = await request(app)
      .post("/api/v1/coach-requests")
      .set("Authorization", `Bearer ${rejoinClient.token}`)
      .send({ token });

    expect(resubmit.status).toBe(200);
    expect(resubmit.body.status).toBe("pending");
    expect(resubmit.body.id).toBe(requestId);
    expect(coachProfile).toBeDefined();
    expect(clientProfile).toBeDefined();
  }, 30000);
});

describe("coach request responses (US4)", () => {
  let coach: { token: string; userId: string };
  let client: { token: string; userId: string };
  let otherCoach: { token: string; userId: string };
  let pendingRequestId: string;

  beforeAll(async () => {
    coach = await signupAndLogin("coach");
    client = await signupAndLogin("client");
    otherCoach = await signupAndLogin("coach");

    const inviteRes = await request(app)
      .post("/api/v1/coach/invite")
      .set("Authorization", `Bearer ${coach.token}`);
    const submitRes = await request(app)
      .post("/api/v1/coach-requests")
      .set("Authorization", `Bearer ${client.token}`)
      .send({ token: inviteRes.body.token });
    pendingRequestId = submitRes.body.id;
  }, 60000);

  it("returns 200 with the pending request", async () => {
    const res = await request(app)
      .get("/api/v1/coach/requests")
      .set("Authorization", `Bearer ${coach.token}`);

    expect(res.status).toBe(200);
    expect(res.body.requests.length).toBe(1);
    expect(res.body.requests[0].id).toBe(pendingRequestId);
    expect(res.body.requests[0].status).toBe("pending");
    expect(res.body.requests[0].client.user.email).toBe(client.email);
  });

  it("returns 404 when accepting another coach's request", async () => {
    const res = await request(app)
      .post(`/api/v1/coach/requests/${pendingRequestId}/accept`)
      .set("Authorization", `Bearer ${otherCoach.token}`);

    expect(res.status).toBe(404);
  });

  it("accepts a pending request: 200, coach_clients row created, visible in GET /coach/clients", async () => {
    const res = await request(app)
      .post(`/api/v1/coach/requests/${pendingRequestId}/accept`)
      .set("Authorization", `Bearer ${coach.token}`);

    expect(res.status).toBe(200);
    expect(res.body.request.status).toBe("accepted");
    expect(res.body.assignment.coach_id).toBeDefined();
    expect(res.body.assignment.client_id).toBeDefined();

    const clientsRes = await request(app)
      .get("/api/v1/coach/clients")
      .set("Authorization", `Bearer ${coach.token}`);
    expect(clientsRes.status).toBe(200);
    expect(clientsRes.body.clients.length).toBe(1);
    expect(clientsRes.body.clients[0].client.user.email).toBe(client.email);
  });

  it("returns 400 when accepting an already-accepted request", async () => {
    const res = await request(app)
      .post(`/api/v1/coach/requests/${pendingRequestId}/accept`)
      .set("Authorization", `Bearer ${coach.token}`);

    expect(res.status).toBe(400);
  });

  it("rejects a pending request: 200 with rejected_at set", async () => {
    const rejectCoach = await signupAndLogin("coach");
    const rejectClient = await signupAndLogin("client");

    const inviteRes = await request(app)
      .post("/api/v1/coach/invite")
      .set("Authorization", `Bearer ${rejectCoach.token}`);
    const submitRes = await request(app)
      .post("/api/v1/coach-requests")
      .set("Authorization", `Bearer ${rejectClient.token}`)
      .send({ token: inviteRes.body.token });
    const requestId = submitRes.body.id;

    const res = await request(app)
      .post(`/api/v1/coach/requests/${requestId}/reject`)
      .set("Authorization", `Bearer ${rejectCoach.token}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("rejected");
    expect(res.body.updated_at).toBeDefined();

    const row = await prisma.coach_requests.findUnique({ where: { id: requestId } });
    expect(row?.status).toBe("rejected");
    expect(row?.rejected_at).not.toBeNull();
  }, 30000);

  it("returns 400 when rejecting a non-pending request", async () => {
    const res = await request(app)
      .post(`/api/v1/coach/requests/${pendingRequestId}/reject`)
      .set("Authorization", `Bearer ${coach.token}`);

    expect(res.status).toBe(400);
  });

  it("returns 400 when accepting a request for a client already assigned to another coach", async () => {
    const coachA = await signupAndLogin("coach");
    const coachB = await signupAndLogin("coach");
    const client = await signupAndLogin("client");

    const inviteA = await request(app)
      .post("/api/v1/coach/invite")
      .set("Authorization", `Bearer ${coachA.token}`);
    const inviteB = await request(app)
      .post("/api/v1/coach/invite")
      .set("Authorization", `Bearer ${coachB.token}`);

    const submitA = await request(app)
      .post("/api/v1/coach-requests")
      .set("Authorization", `Bearer ${client.token}`)
      .send({ token: inviteA.body.token });
    const submitB = await request(app)
      .post("/api/v1/coach-requests")
      .set("Authorization", `Bearer ${client.token}`)
      .send({ token: inviteB.body.token });
    expect(submitA.status).toBe(201);
    expect(submitB.status).toBe(201);

    const acceptA = await request(app)
      .post(`/api/v1/coach/requests/${submitA.body.id}/accept`)
      .set("Authorization", `Bearer ${coachA.token}`);
    expect(acceptA.status).toBe(200);

    const acceptB = await request(app)
      .post(`/api/v1/coach/requests/${submitB.body.id}/accept`)
      .set("Authorization", `Bearer ${coachB.token}`);
    expect(acceptB.status).toBe(400);

    const bRow = await prisma.coach_requests.findUnique({ where: { id: submitB.body.id } });
    expect(bRow?.status).toBe("rejected");
    expect(bRow?.rejected_at).not.toBeNull();
  }, 30000);

  it("returns 403 for a client role", async () => {
    const res = await request(app)
      .get("/api/v1/coach/requests")
      .set("Authorization", `Bearer ${client.token}`);

    expect(res.status).toBe(403);
  });
});

describe("GET /coach/clients (US5)", () => {
  it("returns 200 empty list for a new coach", async () => {
    const fresh = await signupAndLogin("coach");
    const res = await request(app)
      .get("/api/v1/coach/clients")
      .set("Authorization", `Bearer ${fresh.token}`);

    expect(res.status).toBe(200);
    expect(res.body.clients).toEqual([]);
  });

  it("returns 403 for a client role", async () => {
    const client = await signupAndLogin("client");
    const res = await request(app)
      .get("/api/v1/coach/clients")
      .set("Authorization", `Bearer ${client.token}`);

    expect(res.status).toBe(403);
  });
});

describe("GET /client/coach (US6)", () => {
  let coach: { token: string; userId: string };
  let client: { token: string; userId: string };

  beforeAll(async () => {
    coach = await signupAndLogin("coach");
    client = await signupAndLogin("client");

    const inviteRes = await request(app)
      .post("/api/v1/coach/invite")
      .set("Authorization", `Bearer ${coach.token}`);
    const submitRes = await request(app)
      .post("/api/v1/coach-requests")
      .set("Authorization", `Bearer ${client.token}`)
      .send({ token: inviteRes.body.token });
    await request(app)
      .post(`/api/v1/coach/requests/${submitRes.body.id}/accept`)
      .set("Authorization", `Bearer ${coach.token}`);
  }, 60000);

  it("returns 200 with the assigned coach profile", async () => {
    const res = await request(app)
      .get("/api/v1/client/coach")
      .set("Authorization", `Bearer ${client.token}`);

    expect(res.status).toBe(200);
    expect(res.body.coach.id).toBeDefined();
    expect(res.body.coach.user.email).toBe(coach.email);
    expect(res.body.assigned_at).toBeDefined();
  });

  it("returns 404 for a client without an assignment", async () => {
    const unassigned = await signupAndLogin("client");
    const res = await request(app)
      .get("/api/v1/client/coach")
      .set("Authorization", `Bearer ${unassigned.token}`);

    expect(res.status).toBe(404);
  });

  it("returns 403 for a coach role", async () => {
    const res = await request(app)
      .get("/api/v1/client/coach")
      .set("Authorization", `Bearer ${coach.token}`);

    expect(res.status).toBe(403);
  });
});

describe("POST /client/leave-coach (US7)", () => {
  let coach: { token: string; userId: string };
  let client: { token: string; userId: string };

  beforeAll(async () => {
    coach = await signupAndLogin("coach");
    client = await signupAndLogin("client");

    const inviteRes = await request(app)
      .post("/api/v1/coach/invite")
      .set("Authorization", `Bearer ${coach.token}`);
    const submitRes = await request(app)
      .post("/api/v1/coach-requests")
      .set("Authorization", `Bearer ${client.token}`)
      .send({ token: inviteRes.body.token });
    await request(app)
      .post(`/api/v1/coach/requests/${submitRes.body.id}/accept`)
      .set("Authorization", `Bearer ${coach.token}`);
  }, 60000);

  it("leaves the coach: 200, record gone, GET /client/coach → 404", async () => {
    const leaveRes = await request(app)
      .post("/api/v1/client/leave-coach")
      .set("Authorization", `Bearer ${client.token}`);

    expect(leaveRes.status).toBe(200);

    const myCoachRes = await request(app)
      .get("/api/v1/client/coach")
      .set("Authorization", `Bearer ${client.token}`);
    expect(myCoachRes.status).toBe(404);
  });

  it("returns 404 when leaving again without a coach", async () => {
    const res = await request(app)
      .post("/api/v1/client/leave-coach")
      .set("Authorization", `Bearer ${client.token}`);

    expect(res.status).toBe(404);
  });

  it("returns 401 unauthenticated", async () => {
    const res = await request(app).post("/api/v1/client/leave-coach");

    expect(res.status).toBe(401);
  });
});

describe("DELETE /coach/clients/:id (US8)", () => {
  let coach: { token: string; userId: string };
  let client: { token: string; userId: string };
  let clientProfileId: string;

  beforeAll(async () => {
    coach = await signupAndLogin("coach");
    client = await signupAndLogin("client");

    const clientProfile = await prisma.client_profiles.findFirst({
      where: { user: { id: client.userId } },
    });
    clientProfileId = clientProfile!.id;

    const inviteRes = await request(app)
      .post("/api/v1/coach/invite")
      .set("Authorization", `Bearer ${coach.token}`);
    const submitRes = await request(app)
      .post("/api/v1/coach-requests")
      .set("Authorization", `Bearer ${client.token}`)
      .send({ token: inviteRes.body.token });
    await request(app)
      .post(`/api/v1/coach/requests/${submitRes.body.id}/accept`)
      .set("Authorization", `Bearer ${coach.token}`);
  }, 60000);

  it("removes the assigned client: 200, record gone", async () => {
    const res = await request(app)
      .delete(`/api/v1/coach/clients/${clientProfileId}`)
      .set("Authorization", `Bearer ${coach.token}`);

    expect(res.status).toBe(200);

    const clientsRes = await request(app)
      .get("/api/v1/coach/clients")
      .set("Authorization", `Bearer ${coach.token}`);
    expect(clientsRes.body.clients.length).toBe(0);
  });

  it("returns 404 when removing a client not assigned to this coach", async () => {
    const res = await request(app)
      .delete(`/api/v1/coach/clients/${clientProfileId}`)
      .set("Authorization", `Bearer ${coach.token}`);

    expect(res.status).toBe(404);
  });

  it("returns 400 for a malformed id", async () => {
    const res = await request(app)
      .delete("/api/v1/coach/clients/not-a-uuid")
      .set("Authorization", `Bearer ${coach.token}`);

    expect(res.status).toBe(400);
  });

  it("returns 403 for a client role", async () => {
    const res = await request(app)
      .delete(`/api/v1/coach/clients/${clientProfileId}`)
      .set("Authorization", `Bearer ${client.token}`);

    expect(res.status).toBe(403);
  });
});
