import "reflect-metadata";
import { CoachAssignmentService } from "../../src/modules/coach-assignment/coach-assignment.service";
import { WorkoutPlanService } from "../../src/modules/workout/workout-plan.service";
import { NutritionPlanService } from "../../src/modules/nutrition/nutrition-plan.service";
import { CheckInService } from "../../src/modules/checkin/checkin.service";

function makePush() {
  return { sendToUser: jest.fn().mockResolvedValue({ sent: 1 }) };
}

function makeInbox(id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa") {
  return {
    create: jest.fn().mockImplementation((_userId: string, input: Record<string, unknown>) =>
      Promise.resolve({ id, is_read: false, ...input }),
    ),
  };
}

describe("inbox writes on coach request submit", () => {
  it("persists coach_request and links notificationId in push data", async () => {
    const prisma = {
      coach_profiles: {
        findFirst: jest.fn().mockResolvedValue({
          id: "coach-p1",
          user_id: "coach-u1",
          profile_image: null,
        }),
      },
      client_profiles: { findFirst: jest.fn().mockResolvedValue({ id: "client-p1" }) },
      coach_clients: { findFirst: jest.fn().mockResolvedValue(null) },
      coach_requests: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: "req-1",
          coach_id: "coach-p1",
          client_id: "client-p1",
          status: "pending",
        }),
      },
      users: {
        findUnique: jest.fn().mockResolvedValue({ username: "ClientUser" }),
      },
    };
    const push = makePush();
    const inbox = makeInbox();
    const svc = new CoachAssignmentService(prisma as never, {} as never, push as never, inbox as never);

    await svc.submitRequest("client-u1", "ABC123");

    expect(inbox.create).toHaveBeenCalledWith(
      "coach-u1",
      expect.objectContaining({
        type: "coach_request",
        data: expect.objectContaining({
          type: "coach_request",
          requestId: "req-1",
          actorUsername: "ClientUser",
          actorRole: "client",
        }),
      }),
    );
    expect(push.sendToUser).toHaveBeenCalledWith(
      "coach-u1",
      expect.objectContaining({
        data: expect.objectContaining({
          type: "coach_request",
          notificationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        }),
      }),
    );
  });
});

describe("inbox writes on request accept", () => {
  it("persists request_accepted even though push still sends", async () => {
    const tx = {
      coach_clients: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "cc-1", coach_id: "coach-p1", client_id: "client-p1" }),
      },
      coach_requests: {
        update: jest.fn().mockResolvedValue({ id: "req-1", status: "accepted" }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const prisma = {
      coach_profiles: { findFirst: jest.fn().mockResolvedValue({ id: "coach-p1" }) },
      coach_requests: {
        findFirst: jest.fn().mockResolvedValue({
          id: "req-1",
          coach_id: "coach-p1",
          client_id: "client-p1",
          status: "pending",
        }),
      },
      client_profiles: {
        findFirst: jest.fn().mockResolvedValue({ user_id: "client-u1" }),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      users: { findUnique: jest.fn().mockResolvedValue({ username: "CoachUser" }) },
      $transaction: jest.fn().mockImplementation((cb: (t: unknown) => unknown) => cb(tx)),
    };
    const push = makePush();
    const inbox = makeInbox();
    const svc = new CoachAssignmentService(prisma as never, {} as never, push as never, inbox as never);

    await svc.acceptRequest("coach-u1", "req-1");

    expect(inbox.create).toHaveBeenCalledWith(
      "client-u1",
      expect.objectContaining({ type: "request_accepted" }),
    );
    expect(push.sendToUser).toHaveBeenCalledWith(
      "client-u1",
      expect.objectContaining({
        data: expect.objectContaining({ type: "request_accepted" }),
      }),
    );
  });
});

describe("inbox writes on plan assignment", () => {
  it("persists workout_assigned with plan title", async () => {
    const templateDay = {
      title: "Day 1",
      day_number: 1,
      is_rest: false,
      note: "",
      workout_template_exercises: [{ exercise_id: "ex-1", exercise_order: 1, notes: "" }],
    };
    const prisma = {
      coach_clients: {
        findFirst: jest.fn().mockResolvedValue({ id: "cc-1", client_id: "client-p1" }),
        findUnique: jest.fn().mockResolvedValue({ id: "cc-1", client: { user_id: "client-u1" } }),
      },
      workout_templates: {
        findFirst: jest.fn().mockResolvedValue({
          id: "wt-1",
          title: "Template",
          description: "desc",
          workout_template_days: [templateDay],
        }),
      },
      workout_plans: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({
          id: "wp-1",
          coach_id: "coach-p1",
          coach_client_id: "cc-1",
          title: "Hypertrophy",
          description: "",
          start_date: new Date(),
          cycle_days: 1,
          is_active: true,
          deleted_at: null,
          created_at: new Date(),
          workout_days: [],
        }),
      },
      coach_profiles: {
        findUnique: jest.fn().mockResolvedValue({ user: { username: "CoachUser" } }),
      },
      client_profiles: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
    const push = makePush();
    const inbox = makeInbox();
    const svc = new WorkoutPlanService(prisma as never, push as never, inbox as never);

    await svc.assignPlan({ coachId: "coach-p1", coachClientId: "cc-1", templateId: "wt-1" });

    expect(inbox.create).toHaveBeenCalledWith(
      "client-u1",
      expect.objectContaining({
        type: "workout_assigned",
        data: expect.objectContaining({
          type: "workout_assigned",
          actorUsername: "CoachUser",
          actorRole: "coach",
        }),
      }),
    );
    expect(push.sendToUser).toHaveBeenCalledWith(
      "client-u1",
      expect.objectContaining({
        data: expect.objectContaining({ type: "workout_assigned", planId: "wp-1" }),
      }),
    );
  });

  it("persists nutrition_assigned", async () => {
    const prisma = {
      coach_profiles: { findFirst: jest.fn().mockResolvedValue({ id: "coach-p1" }) },
      coach_clients: { findFirst: jest.fn().mockResolvedValue({ id: "cc-1", client_id: "client-p1" }) },
      nutrition_templates: {
        findFirst: jest.fn().mockResolvedValue({
          id: "nt-1",
          nutrition_template_meals: [
            { id: "m-1", meal_type: "breakfast", meal_order: 1, notes: "", nutrition_template_foods: [] },
          ],
        }),
      },
      nutrition_plans: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({ id: "np-1" }),
        findUnique: jest.fn().mockResolvedValue({
          id: "np-1",
          title: "Cutting",
          description: "",
          is_active: true,
          created_at: new Date(),
          _count: { nutrition_meals: 0 },
        }),
      },
      nutrition_meals: { create: jest.fn().mockResolvedValue({ id: "meal-1" }) },
      users: { findUnique: jest.fn().mockResolvedValue({ username: "CoachUser" }) },
      client_profiles: {
        findFirst: jest.fn().mockResolvedValue({ user_id: "client-u1" }),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn().mockImplementation((cb: (t: unknown) => unknown) =>
        cb({
          nutrition_plans: {
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            create: jest.fn().mockResolvedValue({ id: "np-1" }),
            findUnique: jest.fn().mockResolvedValue({
              id: "np-1",
              title: "Cutting",
              description: "",
              is_active: true,
              created_at: new Date(),
              _count: { nutrition_meals: 0 },
            }),
          },
          nutrition_meals: { create: jest.fn().mockResolvedValue({ id: "meal-1" }) },
          nutrition_meal_foods: { create: jest.fn().mockResolvedValue({ id: "f-1" }) },
        }),
      ),
    };
    const push = makePush();
    const inbox = makeInbox();
    const svc = new NutritionPlanService(prisma as never, push as never, inbox as never);

    await svc.createPlanFromTemplate("coach-u1", "nt-1", {
      coach_client_id: "cc-1",
      title: "Cutting",
      description: "",
    } as never);

    expect(inbox.create).toHaveBeenCalledWith(
      "client-u1",
      expect.objectContaining({ type: "nutrition_assigned" }),
    );
  });
});

describe("inbox writes on check-in cycle", () => {
  it("persists checkin_requested on assign", async () => {
    const prisma = {
      coach_clients: { findFirst: jest.fn().mockResolvedValue({ id: "cc-1", client_id: "client-p1" }) },
      checkin_assignments: { upsert: jest.fn().mockResolvedValue({ id: "as-1", status: "pending" }) },
      coach_profiles: { findFirst: jest.fn().mockResolvedValue({ user: { username: "CoachUser" } }) },
      client_profiles: { findFirst: jest.fn().mockResolvedValue({ user_id: "client-u1" }) },
    };
    const push = makePush();
    const inbox = makeInbox();
    const svc = new CheckInService(prisma as never, push as never, inbox as never);

    await svc.assignCheckIn("coach-p1", "cc-1");

    expect(inbox.create).toHaveBeenCalledWith(
      "client-u1",
      expect.objectContaining({ type: "checkin_requested" }),
    );
  });

  it("persists checkin_submitted on submit without breaking when inbox throws", async () => {
    const tx = {
      checkin_submissions: { create: jest.fn().mockResolvedValue({ id: "sub-1" }) },
      checkin_answers: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      checkin_assignments: {
        delete: jest.fn().mockResolvedValue({ id: "as-1" }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const prisma = {
      coach_clients: { findFirst: jest.fn().mockResolvedValue({ id: "cc-1", coach_id: "coach-p1" }) },
      checkin_assignments: { findFirst: jest.fn().mockResolvedValue({ id: "as-1", coach_client_id: "cc-1" }) },
      checkin_questions: {
        findMany: jest.fn().mockResolvedValue([{ id: "q-1", required: true, type: "TEXT", options: [] }]),
      },
      coach_profiles: { findFirst: jest.fn().mockResolvedValue({ user_id: "coach-u1" }) },
      client_profiles: { findFirst: jest.fn().mockResolvedValue({ user: { username: "ClientUser" } }) },
      $transaction: jest.fn().mockImplementation((cb: (t: unknown) => unknown) => cb(tx)),
    };
    const push = makePush();
    const inbox = { create: jest.fn().mockRejectedValue(new Error("db down")) };
    const svc = new CheckInService(prisma as never, push as never, inbox as never);

    const out = await svc.submitCheckIn("client-p1", [{ question_id: "q-1", answer_value: "ok" }], {});

    expect(out.id).toBe("sub-1");
    // Inbox failure is swallowed; push still attempted without notificationId.
    expect(push.sendToUser).toHaveBeenCalledWith(
      "coach-u1",
      expect.objectContaining({
        data: expect.not.objectContaining({ notificationId: expect.anything() }),
      }),
    );
  });
});
