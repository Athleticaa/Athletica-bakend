import "reflect-metadata";
import { WorkoutPlanService } from "../../src/modules/workout/workout-plan.service";
import { NutritionPlanService } from "../../src/modules/nutrition/nutrition-plan.service";

function makePush() {
  return { sendToUser: jest.fn().mockResolvedValue({ sent: 1 }) };
}

describe("WorkoutPlanService.assignPlan push", () => {
  it("notifies the client with the plan title", async () => {
    const templateDay = {
      title: "Day 1",
      day_number: 1,
      is_rest: false,
      note: "",
      workout_template_exercises: [
        { exercise_id: "ex-1", exercise_order: 1, notes: "" },
      ],
    };
    const prisma = {
      coach_clients: {
        findFirst: jest.fn().mockResolvedValue({ id: "cc-1", client_id: "client-p1" }),
        findUnique: jest.fn().mockResolvedValue({
          id: "cc-1",
          client: { user_id: "client-u1" },
        }),
      },
      client_profiles: {
        findUnique: jest.fn().mockResolvedValue(null),
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
        findUnique: jest.fn().mockResolvedValue({
          user: { username: "CoachUser" },
        }),
      },
    };
    const push = makePush();
    const svc = new WorkoutPlanService(prisma as never, push as never);

    const out = await svc.assignPlan({
      coachId: "coach-p1",
      coachClientId: "cc-1",
      templateId: "wt-1",
    });

    expect(out.id).toBe("wp-1");
    expect(push.sendToUser).toHaveBeenCalledWith(
      "client-u1",
      expect.objectContaining({
        data: expect.objectContaining({ type: "workout_assigned", planId: "wp-1" }),
      }),
    );
  });
});

describe("NutritionPlanService.createPlanFromTemplate push", () => {
  it("notifies the client with the plan title", async () => {
    const prisma = {
      coach_profiles: {
        findFirst: jest.fn().mockResolvedValue({ id: "coach-p1" }),
      },
      coach_clients: {
        findFirst: jest.fn().mockResolvedValue({ id: "cc-1", client_id: "client-p1" }),
      },
      nutrition_templates: {
        findFirst: jest.fn().mockResolvedValue({
          id: "nt-1",
          nutrition_template_meals: [
            {
              id: "m-1",
              meal_type: "breakfast",
              meal_order: 1,
              notes: "",
              nutrition_template_foods: [],
            },
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
      nutrition_meals: {
        create: jest.fn().mockResolvedValue({ id: "meal-1" }),
      },
      users: {
        findUnique: jest.fn().mockResolvedValue({ username: "CoachUser" }),
      },
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
          nutrition_meals: {
            create: jest.fn().mockResolvedValue({ id: "meal-1" }),
          },
          nutrition_meal_foods: {
            create: jest.fn().mockResolvedValue({ id: "f-1" }),
          },
        }),
      ),
    };
    const push = makePush();
    const svc = new NutritionPlanService(prisma as never, push as never);

    const out = await svc.createPlanFromTemplate("coach-u1", "nt-1", {
      coach_client_id: "cc-1",
      title: "Cutting",
      description: "",
    } as never);

    expect(out.id).toBe("np-1");
    expect(push.sendToUser).toHaveBeenCalledWith(
      "client-u1",
      expect.objectContaining({
        data: expect.objectContaining({ type: "nutrition_assigned", planId: "np-1" }),
      }),
    );
  });
});
