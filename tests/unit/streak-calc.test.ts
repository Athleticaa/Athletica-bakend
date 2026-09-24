import { calcStreak, toCairoDateOnly, todayDateOnly, formatDateOnly } from "../../src/modules/nutrition/nutrition.utils";

describe("calcStreak", () => {
  test("counts a clean run with no rest days", () => {
    const res = calcStreak(["completed", "completed", "completed"]);
    expect(res.current_streak).toBe(3);
    expect(res.longest_streak).toBe(3);
    expect(res.total_completed).toBe(3);
    expect(res.total_missed).toBe(0);
    expect(res.rest_days).toBe(0);
    expect(res.total_days).toBe(3);
    expect(res.completion_rate).toBe(1);
  });

  test("rest days are skipped — neither break nor extend a run", () => {
    const res = calcStreak(["completed", "rest", "completed", "completed"]);
    expect(res.current_streak).toBe(3);
    expect(res.longest_streak).toBe(3);
    expect(res.rest_days).toBe(1);
    expect(res.completion_rate).toBe(1);
  });

  test("a missed day breaks the run for longest_streak", () => {
    const res = calcStreak(["completed", "completed", "missed", "completed"]);
    expect(res.longest_streak).toBe(2);
    expect(res.total_missed).toBe(1);
    expect(res.completion_rate).toBeCloseTo(0.75, 5);
  });

  test("today missed falls back to yesterday for current_streak", () => {
    const res = calcStreak(["completed", "completed", "completed", "missed"]);
    expect(res.current_streak).toBe(3);
    expect(res.longest_streak).toBe(3);
  });

  test("today missed with no prior run gives zero current streak", () => {
    const res = calcStreak(["missed", "missed"]);
    expect(res.current_streak).toBe(0);
    expect(res.longest_streak).toBe(0);
    expect(res.completion_rate).toBe(0);
  });

  test("trailing rest days do not hide the run", () => {
    const res = calcStreak(["completed", "completed", "rest"]);
    expect(res.current_streak).toBe(2);
    expect(res.longest_streak).toBe(2);
  });

  test("all-rest window yields zeros without NaN rate", () => {
    const res = calcStreak(["rest", "rest"]);
    expect(res.current_streak).toBe(0);
    expect(res.longest_streak).toBe(0);
    expect(res.total_days).toBe(2);
    expect(res.rest_days).toBe(2);
    expect(res.completion_rate).toBe(0);
  });

  test("empty window yields zeros", () => {
    const res = calcStreak([]);
    expect(res.current_streak).toBe(0);
    expect(res.longest_streak).toBe(0);
    expect(res.total_days).toBe(0);
    expect(res.completion_rate).toBe(0);
  });

  test("completion_rate rounds to 2 decimals and excludes rest", () => {
    const res = calcStreak(["completed", "missed", "missed", "rest"]);
    // 1 completed / (4 - 1 rest) = 0.3333… -> 0.33
    expect(res.completion_rate).toBe(0.33);
  });
});

describe("toCairoDateOnly", () => {
  test("truncates to UTC midnight and matches the Cairo calendar day", () => {
    const now = new Date();
    const res = toCairoDateOnly(now);
    expect(res.getUTCHours()).toBe(0);
    expect(formatDateOnly(res)).toBe(formatDateOnly(todayDateOnly()));
  });
});
