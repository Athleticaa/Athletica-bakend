import "reflect-metadata";
import { NutritionClientService } from "../../src/modules/nutrition/nutrition-client.service";
import { todayDateOnly, addDays, formatDateOnly } from "../../src/modules/nutrition/nutrition.utils";

function makePrismaMock() {
  return {
    client_profiles: { findFirst: jest.fn() },
    coach_profiles: { findFirst: jest.fn() },
    coach_clients: { findFirst: jest.fn() },
    nutrition_meal_logs: { findMany: jest.fn() },
  };
}

function getService(mockPrisma: unknown): NutritionClientService {
  return new NutritionClientService(mockPrisma as any);
}

beforeEach(() => {
  jest.clearAllMocks();
});

function assignment(createdDaysAgo: number) {
  const d = addDays(todayDateOnly(), -createdDaysAgo);
  return { id: "cc-1", coach_id: "coach-1", client_id: "client-1", created_at: d };
}

function log(dateKey: string, completed: boolean) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return { date: new Date(Date.UTC(y, m - 1, d)), completed };
}

describe("NutritionClientService streak", () => {
  it("returns 404 when the client has no assignment", async () => {
    const mock = makePrismaMock();
    (mock.client_profiles.findFirst as jest.Mock).mockResolvedValue({ id: "client-1" });
    (mock.coach_clients.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(getService(mock).getStreakSelf("user-1")).rejects.toMatchObject({
      messageKey: "assignment_not_found",
      statusCode: 404,
    });
  });

  it("fills gap days as missed and counts completed days", async () => {
    const today = todayDateOnly();
    const keys = [0, 1, 2].map((n) => formatDateOnly(addDays(today, -n)));
    const mock = makePrismaMock();
    (mock.client_profiles.findFirst as jest.Mock).mockResolvedValue({ id: "client-1" });
    (mock.coach_clients.findFirst as jest.Mock).mockResolvedValue(assignment(2));
    (mock.nutrition_meal_logs.findMany as jest.Mock).mockResolvedValue([
      log(keys[2], true),
      log(keys[2], true),
      log(keys[1], true),
      log(keys[1], false),
    ]);

    const res = await getService(mock).getStreakSelf("user-1");
    expect(res.client_id).toBe("client-1");
    expect(res.coach_client_id).toBe("cc-1");
    expect(res.rest_days).toBe(0);
    expect(res.days.length).toBe(3);
    expect(res.days[0]).toMatchObject({ date: keys[2], status: "completed", total_meals: 2, completed_meals: 2 });
    expect(res.days[1]).toMatchObject({ date: keys[1], status: "missed", total_meals: 2, completed_meals: 1 });
    // today has no logs → missed
    expect(res.days[2]).toMatchObject({ date: keys[0], status: "missed", total_meals: 0, completed_meals: 0 });
    expect(res.total_completed).toBe(1);
    expect(res.total_missed).toBe(2);
    // today pending → current falls back to the run before it (zero here: yesterday missed)
    expect(res.current_streak).toBe(0);
    expect(res.longest_streak).toBe(1);
    expect(res.completion_rate).toBeCloseTo(0.33, 2);
  });

  it("coach view rejects foreign ids and serves owned assignments", async () => {
    const mock = makePrismaMock();
    (mock.coach_profiles.findFirst as jest.Mock).mockResolvedValue({ id: "coach-1" });
    (mock.coach_clients.findFirst as jest.Mock).mockResolvedValueOnce(null);
    await expect(getService(mock).getStreakByCoachClient("coach-user", "cc-x")).rejects.toMatchObject({
      statusCode: 404,
    });

    (mock.coach_clients.findFirst as jest.Mock).mockResolvedValueOnce(assignment(0));
    (mock.nutrition_meal_logs.findMany as jest.Mock).mockResolvedValue([]);
    const res = await getService(mock).getStreakByCoachClient("coach-user", "cc-1");
    expect(res.coach_client_id).toBe("cc-1");
    expect(res.days.length).toBe(1);
    expect(res.days[0].status).toBe("missed");
  });
});
