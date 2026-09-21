import "reflect-metadata";
import { WorkoutClientService } from "../../src/modules/workout/workout-client.service";
import { WorkoutPlanService } from "../../src/modules/workout/workout-plan.service";
import { ServiceError } from "../../src/lib/service-error";
import { todayDateOnly, addDays, formatDateOnly } from "../../src/modules/nutrition/nutrition.utils";

function makePrismaMock() {
  return {
    client_profiles: { findFirst: jest.fn() },
    workout_plans: { findFirst: jest.fn() },
    workout_exercise_logs: {
      createMany: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
  };
}

function getService(mockPrisma: unknown): WorkoutClientService {
  return new WorkoutClientService(mockPrisma as any);
}

function expectServiceError(promise: Promise<unknown>, key: string, statusCode: number) {
  return promise.then(
    () => {
      throw new Error("expected ServiceError to be thrown");
    },
    (err) => {
      expect(err).toBeInstanceOf(ServiceError);
      expect((err as ServiceError).messageKey).toBe(key);
      expect((err as ServiceError).statusCode).toBe(statusCode);
    }
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

function planWithDay(exercises: Array<{ id: string; order: number }>, isRest = false) {
  const today = todayDateOnly();
  return {
    id: "plan-1",
    start_date: today,
    cycle_days: 1,
    workout_days: [
      {
        id: "day-1",
        title: "Day 1",
        day_number: 1,
        is_rest: isRest,
        workout_day_exercises: exercises.map((e) => ({
          id: e.id,
          exercise_id: `ex-${e.id}`,
          order_number: e.order,
          sets: 3,
          reps: 10,
          notes: "",
          exercise: { id: `ex-${e.id}` },
        })),
      },
    ],
  };
}

function exerciseLog(id: string, planExerciseId: string, completed: boolean) {
  return {
    id,
    workout_plan_id: "plan-1",
    workout_day_id: "day-1",
    workout_day_exercise_id: planExerciseId,
    workout_date: todayDateOnly(),
    completed,
    completed_at: completed ? new Date() : null,
    workout_day_exercise: {
      id: planExerciseId,
      exercise_id: `ex-${planExerciseId}`,
      order_number: 1,
      sets: 3,
      reps: 10,
      notes: "",
      exercise: { id: `ex-${planExerciseId}` },
    },
  };
}

describe("WorkoutClientService.getTodayWorkout (per-exercise logs)", () => {
  it("creates one log per exercise and reports day_completed=false when none completed", async () => {
    const mockPrisma = makePrismaMock();
    mockPrisma.client_profiles.findFirst.mockResolvedValue({ id: "client-1" });
    mockPrisma.workout_plans.findFirst.mockResolvedValue(
      planWithDay([{ id: "pe-1", order: 1 }, { id: "pe-2", order: 2 }])
    );
    mockPrisma.workout_exercise_logs.createMany.mockResolvedValue({ count: 2 });
    mockPrisma.workout_exercise_logs.findMany.mockResolvedValue([
      exerciseLog("log-1", "pe-1", false),
      exerciseLog("log-2", "pe-2", false),
    ]);

    const result = await getService(mockPrisma).getTodayWorkout("user-1");

    expect(mockPrisma.workout_exercise_logs.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true })
    );
    expect(mockPrisma.workout_exercise_logs.createMany.mock.calls[0][0].data).toHaveLength(2);
    expect(result.workout).toBeDefined();
    expect(result.workout!.exercises).toHaveLength(2);
    expect(result.workout!.exercises[0].log_id).toBe("log-1");
    expect(result.workout!.day_completed).toBe(false);
  });

  it("reports day_completed=true when all exercise logs are completed", async () => {
    const mockPrisma = makePrismaMock();
    mockPrisma.client_profiles.findFirst.mockResolvedValue({ id: "client-1" });
    mockPrisma.workout_plans.findFirst.mockResolvedValue(
      planWithDay([{ id: "pe-1", order: 1 }, { id: "pe-2", order: 2 }])
    );
    mockPrisma.workout_exercise_logs.createMany.mockResolvedValue({ count: 0 });
    mockPrisma.workout_exercise_logs.findMany.mockResolvedValue([
      exerciseLog("log-1", "pe-1", true),
      exerciseLog("log-2", "pe-2", true),
    ]);

    const result = await getService(mockPrisma).getTodayWorkout("user-1");

    expect(result.workout!.day_completed).toBe(true);
  });

  it("returns day_completed=true with empty exercises on rest days", async () => {
    const mockPrisma = makePrismaMock();
    mockPrisma.client_profiles.findFirst.mockResolvedValue({ id: "client-1" });
    mockPrisma.workout_plans.findFirst.mockResolvedValue(planWithDay([], true));

    const result = await getService(mockPrisma).getTodayWorkout("user-1");

    expect(result.workout!.is_rest).toBe(true);
    expect(result.workout!.exercises).toHaveLength(0);
    expect(result.workout!.day_completed).toBe(true);
    expect(mockPrisma.workout_exercise_logs.createMany).not.toHaveBeenCalled();
  });
});

describe("WorkoutClientService.completeExercise / uncompleteExercise", () => {
  it("completes an exercise and reports day_completed=true when it was the last one", async () => {
    const mockPrisma = makePrismaMock();
    mockPrisma.client_profiles.findFirst.mockResolvedValue({ id: "client-1" });
    mockPrisma.workout_exercise_logs.findFirst.mockResolvedValue(exerciseLog("log-1", "pe-1", false));
    mockPrisma.workout_exercise_logs.update.mockResolvedValue(exerciseLog("log-1", "pe-1", true));
    mockPrisma.workout_exercise_logs.count
      .mockResolvedValueOnce(2) // total
      .mockResolvedValueOnce(2); // completed

    const result = await getService(mockPrisma).completeExercise("user-1", "log-1");

    expect(mockPrisma.workout_exercise_logs.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "log-1" } })
    );
    expect(result.exercise_log.completed).toBe(true);
    expect(result.day_completed).toBe(true);
  });

  it("completes an exercise and reports day_completed=false when others remain", async () => {
    const mockPrisma = makePrismaMock();
    mockPrisma.client_profiles.findFirst.mockResolvedValue({ id: "client-1" });
    mockPrisma.workout_exercise_logs.findFirst.mockResolvedValue(exerciseLog("log-1", "pe-1", false));
    mockPrisma.workout_exercise_logs.update.mockResolvedValue(exerciseLog("log-1", "pe-1", true));
    mockPrisma.workout_exercise_logs.count
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);

    const result = await getService(mockPrisma).completeExercise("user-1", "log-1");

    expect(result.day_completed).toBe(false);
  });

  it("returns already-completed log as-is", async () => {
    const mockPrisma = makePrismaMock();
    mockPrisma.client_profiles.findFirst.mockResolvedValue({ id: "client-1" });
    mockPrisma.workout_exercise_logs.findFirst.mockResolvedValue(exerciseLog("log-1", "pe-1", true));
    mockPrisma.workout_exercise_logs.count
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1);

    const result = await getService(mockPrisma).completeExercise("user-1", "log-1");

    expect(mockPrisma.workout_exercise_logs.update).not.toHaveBeenCalled();
    expect(result.exercise_log.completed).toBe(true);
    expect(result.day_completed).toBe(true);
  });

  it("uncompletes an exercise and flips day_completed to false", async () => {
    const mockPrisma = makePrismaMock();
    mockPrisma.client_profiles.findFirst.mockResolvedValue({ id: "client-1" });
    mockPrisma.workout_exercise_logs.findFirst.mockResolvedValue(exerciseLog("log-1", "pe-1", true));
    mockPrisma.workout_exercise_logs.update.mockResolvedValue(exerciseLog("log-1", "pe-1", false));
    mockPrisma.workout_exercise_logs.count
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);

    const result = await getService(mockPrisma).uncompleteExercise("user-1", "log-1");

    expect(result.exercise_log.completed).toBe(false);
    expect(result.day_completed).toBe(false);
  });

  it("throws exercise_log_not_found for unknown log", async () => {
    const mockPrisma = makePrismaMock();
    mockPrisma.client_profiles.findFirst.mockResolvedValue({ id: "client-1" });
    mockPrisma.workout_exercise_logs.findFirst.mockResolvedValue(null);

    await expectServiceError(getService(mockPrisma).completeExercise("user-1", "missing"), "exercise_log_not_found", 404);
  });

  it("throws workout_today_only for a log from another date", async () => {
    const mockPrisma = makePrismaMock();
    mockPrisma.client_profiles.findFirst.mockResolvedValue({ id: "client-1" });
    const stale = exerciseLog("log-1", "pe-1", false);
    stale.workout_date = new Date("2000-01-01T00:00:00.000Z");
    mockPrisma.workout_exercise_logs.findFirst.mockResolvedValue(stale);

    await expectServiceError(getService(mockPrisma).completeExercise("user-1", "log-1"), "workout_today_only", 400);
  });

  it("throws exercise_not_completed when uncompleting an incomplete log", async () => {
    const mockPrisma = makePrismaMock();
    mockPrisma.client_profiles.findFirst.mockResolvedValue({ id: "client-1" });
    mockPrisma.workout_exercise_logs.findFirst.mockResolvedValue(exerciseLog("log-1", "pe-1", false));

    await expectServiceError(getService(mockPrisma).uncompleteExercise("user-1", "log-1"), "exercise_not_completed", 400);
  });
});

describe("WorkoutPlanService edit-after-fetch (FK safety)", () => {
  function makePlanPrismaMock() {
    const order: string[] = [];
    const tx: any = {
      workout_exercise_logs: {
        deleteMany: jest.fn().mockImplementation(async () => {
          order.push("exercise_logs");
          return {};
        }),
      },
      workout_logs: { deleteMany: jest.fn().mockResolvedValue({}) },
      workout_day_exercises: {
        delete: jest.fn().mockImplementation(async () => {
          order.push("day_exercises");
          return {};
        }),
        deleteMany: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
      workout_days: {
        delete: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const mockPrisma: any = {
      coach_profiles: { findFirst: jest.fn().mockResolvedValue({ id: "coach-1" }) },
      workout_plans: {
        findFirst: jest.fn().mockResolvedValue({ id: "plan-1", title: "P", workout_days: [] }),
      },
      workout_days: { findFirst: jest.fn().mockResolvedValue({ id: "day-1" }) },
      workout_day_exercises: { findFirst: jest.fn().mockResolvedValue({ id: "pe-1" }) },
      $transaction: jest.fn().mockImplementation((cb: (tx: any) => unknown) => cb(tx)),
    };
    return { mockPrisma, tx, order };
  }

  it("removeExerciseFromPlanDay deletes the exercise's logs before the exercise row", async () => {
    const { mockPrisma, tx, order } = makePlanPrismaMock();
    const service = new WorkoutPlanService(mockPrisma);

    await service.removeExerciseFromPlanDay("plan-1", "coach-1", "day-1", "pe-1");

    expect(tx.workout_exercise_logs.deleteMany).toHaveBeenCalledWith({
      where: { workout_day_exercise_id: "pe-1" },
    });
    expect(order).toEqual(["exercise_logs", "day_exercises"]);
  });

  it("deletePlanDay clears exercise logs and day logs before deleting the day", async () => {
    const { mockPrisma, tx } = makePlanPrismaMock();
    const service = new WorkoutPlanService(mockPrisma);

    await service.deletePlanDay("plan-1", "coach-1", "day-1");

    expect(tx.workout_exercise_logs.deleteMany).toHaveBeenCalledWith({
      where: { workout_day_id: "day-1" },
    });
    expect(tx.workout_logs.deleteMany).toHaveBeenCalledWith({
      where: { workout_day_id: "day-1" },
    });
    expect(tx.workout_days.delete).toHaveBeenCalledWith({ where: { id: "day-1" } });
  });
});

describe("WorkoutClientService.getHistory (assign date → today)", () => {
  function historyPlan() {
    const start = addDays(todayDateOnly(), -2);
    return {
      id: "plan-1",
      start_date: start,
      cycle_days: 7,
      workout_days: [
        { id: "day-1", title: "Push", day_number: 1, is_rest: false, _count: { workout_day_exercises: 2 } },
        { id: "day-2", title: "Rest", day_number: 2, is_rest: true, _count: { workout_day_exercises: 0 } },
        { id: "day-3", title: "Pull", day_number: 3, is_rest: false, _count: { workout_day_exercises: 1 } },
      ],
    };
  }

  function historyLog(id: string, date: Date, completed: boolean, dayId = "day-1") {
    return {
      id,
      workout_plan_id: "plan-1",
      workout_day_id: dayId,
      workout_date: date,
      completed,
      workout_day: { id: dayId, title: "Push", day_number: 1, is_rest: false },
    };
  }

  function makeHistoryPrismaMock(plan: unknown, logs: unknown[]) {
    return {
      client_profiles: { findFirst: jest.fn().mockResolvedValue({ id: "client-1" }) },
      workout_plans: { findFirst: jest.fn().mockResolvedValue(plan) },
      workout_exercise_logs: { findMany: jest.fn().mockResolvedValue(logs) },
    };
  }

  it("returns one entry per date from start to today with day info", async () => {
    const plan = historyPlan();
    const start = plan.start_date as Date;
    const mockPrisma = makeHistoryPrismaMock(plan, [
      historyLog("log-1", start, true),
      historyLog("log-2", start, false),
    ]);

    const result = await new WorkoutClientService(mockPrisma as any).getHistory("user-1");

    expect(result.history).toHaveLength(3);
    // Start date: 1/2 completed, with day info from the logs
    expect(result.history[0]).toMatchObject({
      date: formatDateOnly(start),
      day_id: "day-1",
      day_number: 1,
      title: "Push",
      is_rest: false,
      total_exercises: 2,
      completed_exercises: 1,
      all_completed: false,
    });
    // Rest day without logs: complete, with expected day info
    expect(result.history[1]).toMatchObject({
      day_id: "day-2",
      is_rest: true,
      total_exercises: 0,
      completed_exercises: 0,
      all_completed: true,
    });
    // Today (training day, no logs yet): missed, not completed
    expect(result.history[2]).toMatchObject({
      date: formatDateOnly(todayDateOnly()),
      day_id: "day-3",
      is_rest: false,
      total_exercises: 1,
      completed_exercises: 0,
      all_completed: false,
    });
  });

  it("marks a fully completed day as all_completed", async () => {
    const plan = historyPlan();
    const start = plan.start_date as Date;
    const mockPrisma = makeHistoryPrismaMock(plan, [
      historyLog("log-1", start, true),
      historyLog("log-2", start, true),
    ]);

    const result = await new WorkoutClientService(mockPrisma as any).getHistory("user-1");

    expect(result.history[0]).toMatchObject({
      total_exercises: 2,
      completed_exercises: 2,
      all_completed: true,
    });
  });

  it("returns empty history when there is no plan and no logs", async () => {
    const mockPrisma = makeHistoryPrismaMock(null, []);

    const result = await new WorkoutClientService(mockPrisma as any).getHistory("user-1");

    expect(result.history).toEqual([]);
  });
});
