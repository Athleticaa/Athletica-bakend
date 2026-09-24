import "reflect-metadata";
import { WorkoutClientService } from "../../src/modules/workout/workout-client.service";
import { todayDateOnly, addDays, formatDateOnly } from "../../src/modules/nutrition/nutrition.utils";

function makePrismaMock(overrides: Record<string, unknown> = {}) {
  return {
    client_profiles: { findFirst: jest.fn() },
    coach_profiles: { findFirst: jest.fn() },
    coach_clients: { findFirst: jest.fn() },
    workout_plans: { findFirst: jest.fn() },
    workout_exercise_logs: { findMany: jest.fn() },
    ...overrides,
  };
}

function getService(mockPrisma: unknown): WorkoutClientService {
  return new WorkoutClientService(mockPrisma as any);
}

beforeEach(() => {
  jest.clearAllMocks();
});

function assignment(createdDaysAgo: number) {
  const d = addDays(todayDateOnly(), -createdDaysAgo);
  return { id: "cc-1", coach_id: "coach-1", client_id: "client-1", created_at: d };
}

function twoDayPlan() {
  return {
    id: "plan-1",
    start_date: addDays(todayDateOnly(), -3),
    cycle_days: 2,
    workout_days: [
      { id: "day-1", title: "Push", day_number: 1, is_rest: false, _count: { workout_day_exercises: 2 } },
      { id: "day-2", title: "Rest", day_number: 2, is_rest: true, _count: { workout_day_exercises: 0 } },
    ],
  };
}

function log(dateKey: string, completed: boolean, dayId = "day-1") {
  const [y, m, d] = dateKey.split("-").map(Number);
  return { workout_date: new Date(Date.UTC(y, m - 1, d)), completed, workout_day_id: dayId };
}

describe("WorkoutClientService streak", () => {
  it("returns 404 when the client has no assignment", async () => {
    const mock = makePrismaMock();
    (mock.client_profiles.findFirst as jest.Mock).mockResolvedValue({ id: "client-1" });
    (mock.coach_clients.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(getService(mock).getStreakSelf("user-1")).rejects.toMatchObject({
      messageKey: "assignment_not_found",
      statusCode: 404,
    });
  });

  it("returns one entry per day from assignment start with rest/completed/missed flags", async () => {
    const today = todayDateOnly();
    const keys = [0, 1, 2, 3].map((n) => formatDateOnly(addDays(today, -n)));
    // keys[3..0] = oldest → today
    const mock = makePrismaMock();
    (mock.client_profiles.findFirst as jest.Mock).mockResolvedValue({ id: "client-1" });
    (mock.coach_clients.findFirst as jest.Mock).mockResolvedValue(assignment(3));
    (mock.workout_plans.findFirst as jest.Mock).mockResolvedValue(twoDayPlan());
    (mock.workout_exercise_logs.findMany as jest.Mock).mockResolvedValue([
      // oldest day: all completed
      log(keys[3], true),
      log(keys[3], true),
      // next: partial → missed
      log(keys[2], true),
      log(keys[2], false),
      // next: no logs → missed (unless rest by cycle)
    ]);

    const res: any = await getService(mock).getStreakSelf("user-1");
    expect(res.client_id).toBe("client-1");
    expect(res.coach_client_id).toBe("cc-1");
    expect(res.to).toBe(formatDateOnly(today));
    expect(res.days.length).toBe(res.total_days);
    expect(res.days.length).toBe(4);
    expect(res.days[0].date).toBe(keys[3]);
    for (const day of res.days) {
      expect(["completed", "missed", "rest"]).toContain(day.status);
      if (day.status === "rest") {
        expect(day.is_rest).toBe(true);
        expect(day.total_exercises).toBe(0);
        expect(day.completed_exercises).toBe(0);
      } else if (day.status === "completed") {
        expect(day.completed_exercises).toBe(day.total_exercises);
        expect(day.total_exercises).toBeGreaterThan(0);
      }
    }
    expect(res.total_completed + res.total_missed + res.rest_days).toBe(res.total_days);
    expect(res.current_streak).toBeGreaterThanOrEqual(0);
    expect(res.longest_streak).toBeGreaterThanOrEqual(res.current_streak);
  });

  it("coach view resolves via coach_clients.id and rejects foreign ids", async () => {
    const mock = makePrismaMock();
    (mock.coach_profiles.findFirst as jest.Mock).mockResolvedValue({ id: "coach-1" });
    (mock.coach_clients.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(getService(mock).getStreakByCoachClient("coach-user", "cc-x")).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("coach view returns the same shape for an owned assignment", async () => {
    const mock = makePrismaMock();
    (mock.coach_profiles.findFirst as jest.Mock).mockResolvedValue({ id: "coach-1" });
    (mock.coach_clients.findFirst as jest.Mock).mockResolvedValue(assignment(1));
    (mock.workout_plans.findFirst as jest.Mock).mockResolvedValue(null);
    (mock.workout_exercise_logs.findMany as jest.Mock).mockResolvedValue([]);
    const res: any = await getService(mock).getStreakByCoachClient("coach-user", "cc-1");
    expect(res.coach_client_id).toBe("cc-1");
    expect(res.client_id).toBe("client-1");
    expect(res.days.length).toBe(2);
    expect(res.total_missed).toBe(2);
  });

  it("clamps a future-dated assignment to a 1-day window", async () => {
    const mock = makePrismaMock();
    (mock.client_profiles.findFirst as jest.Mock).mockResolvedValue({ id: "client-1" });
    (mock.coach_clients.findFirst as jest.Mock).mockResolvedValue(assignment(-1));
    (mock.workout_plans.findFirst as jest.Mock).mockResolvedValue(null);
    (mock.workout_exercise_logs.findMany as jest.Mock).mockResolvedValue([]);
    const res: any = await getService(mock).getStreakSelf("user-1");
    expect(res.days.length).toBe(1);
    expect(res.total_days).toBe(1);
    expect(res.from).toBe(res.to);
  });
});
