/**
 * Tenant-isolation regression tests for owner-scoped cache keys.
 *
 * Uses an in-memory ioredis fake so getOrSet/refresh exercise the real HIT
 * paths (the disabled-clean suite in cache.test.ts only covers MISS paths).
 * Proves: coach B can never HIT coach A's cached template/plan, and
 * nutrition plan refresh warms (not drops) the item key.
 */

const store = new Map<string, string>();

class FakeRedis {
  status: string = "wait";

  constructor(_url?: string, _opts?: unknown) {}

  on(_event: string, _listener: (...args: unknown[]) => void): this {
    return this;
  }

  async connect(): Promise<void> {
    if (this.status === "ready") return;
    if (this.status === "connecting") throw new Error("Redis is already connecting/connected");
    this.status = "connecting";
    this.status = "ready";
  }

  disconnect(): void {
    this.status = "end";
  }

  async ping(): Promise<string> {
    if (this.status !== "ready") throw new Error("Connection is closed");
    return "PONG";
  }

  async get(key: string): Promise<string | null> {
    if (this.status !== "ready") throw new Error("Connection is closed");
    return store.has(key) ? (store.get(key) as string) : null;
  }

  async set(key: string, value: string, ..._rest: unknown[]): Promise<string> {
    if (this.status !== "ready") throw new Error("Connection is closed");
    store.set(key, value);
    return "OK";
  }

  async del(...keys: string[]): Promise<number> {
    let n = 0;
    for (const k of keys) {
      if (store.delete(k)) n++;
    }
    return n;
  }

  async unlink(...keys: string[]): Promise<number> {
    return this.del(...keys);
  }

  async scan(_cursor: string, ...args: unknown[]): Promise<[string, string[]]> {
    const matchIndex = args.indexOf("MATCH");
    const pattern = matchIndex >= 0 ? String(args[matchIndex + 1]) : "*";
    const regex = new RegExp("^" + pattern.split("*").map(escapeRegex).join(".*") + "$");
    return ["0", [...store.keys()].filter((k) => regex.test(k))];
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

jest.mock("ioredis", () => ({
  __esModule: true,
  default: FakeRedis,
}));

const COACH_A = "coach-aaaa";
const COACH_B = "coach-bbbb";
const TEMPLATE_ID = "tmpl-1";
const PLAN_ID = "wplan-1";
const NPLAN_ID = "nplan-1";

const OLD_REDIS = process.env.REDIS_URL;

function freshModules() {
  jest.resetModules();
  store.clear();
  process.env.REDIS_URL = "rediss://mock:6379";
  process.env.CACHE_ENABLED = "true";
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cache = require("../../src/lib/cache") as typeof import("../../src/lib/cache");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { WorkoutTemplateService } = require("../../src/modules/workout/workout-template.service") as typeof import(
    "../../src/modules/workout/workout-template.service"
  );
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { WorkoutPlanService } = require("../../src/modules/workout/workout-plan.service") as typeof import(
    "../../src/modules/workout/workout-plan.service"
  );
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { NutritionPlanService } = require("../../src/modules/nutrition/nutrition-plan.service") as typeof import(
    "../../src/modules/nutrition/nutrition-plan.service"
  );
  return { cache, WorkoutTemplateService, WorkoutPlanService, NutritionPlanService };
}

afterEach(() => {
  if (OLD_REDIS === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = OLD_REDIS;
  delete process.env.CACHE_ENABLED;
  store.clear();
  jest.resetModules();
});

function templateRow(coachId: string) {
  return {
    id: TEMPLATE_ID,
    coach_id: coachId,
    title: `Template of ${coachId}`,
    description: "",
    workout_template_days: [],
  };
}

/** Mock prisma enforcing coach ownership exactly like the real loaders. */
function workoutPrisma() {
  return {
    workout_templates: {
      findFirst: jest.fn(async (args: { where: { id: string; coach_id: string } }) =>
        args.where.coach_id === COACH_A ? templateRow(COACH_A) : null,
      ),
    },
    workout_plans: {
      findFirst: jest.fn(async (args: { where: { id: string; coach_id: string } }) =>
        args.where.coach_id === COACH_A
          ? { id: PLAN_ID, coach_id: COACH_A, coach_client_id: "cc-1", workout_days: [] }
          : null,
      ),
    },
  };
}

describe("Owner-scoped cache keys (tenant isolation)", () => {
  it("coach B gets 404 on coach A's template id instead of a cross-coach HIT", async () => {
    const { WorkoutTemplateService } = freshModules();
    const svc = new WorkoutTemplateService(workoutPrisma() as never);

    const first = await svc.getTemplate(TEMPLATE_ID, COACH_A);
    expect(first.hit).toBe(false);
    expect(first.value.title).toBe(`Template of ${COACH_A}`);

    const second = await svc.getTemplate(TEMPLATE_ID, COACH_A);
    expect(second.hit).toBe(true);

    await expect(svc.getTemplate(TEMPLATE_ID, COACH_B)).rejects.toMatchObject({
      messageKey: "template_not_found",
    });
  });

  it("coach B gets 404 on coach A's plan id instead of a cross-coach HIT", async () => {
    const { WorkoutPlanService } = freshModules();
    const svc = new WorkoutPlanService(workoutPrisma() as never);

    const first = await svc.getClientPlan(PLAN_ID, COACH_A);
    expect(first.hit).toBe(false);

    const second = await svc.getClientPlan(PLAN_ID, COACH_A);
    expect(second.hit).toBe(true);
    expect(second.value.id).toBe(PLAN_ID);

    await expect(svc.getClientPlan(PLAN_ID, COACH_B)).rejects.toMatchObject({
      messageKey: "plan_not_found",
    });
  });

  it("nutrition plan meal mutation warms (not drops) the coach-scoped item key", async () => {
    const { cache, NutritionPlanService } = freshModules();
    const mealRow = {
      id: "meal-1",
      meal_type: "breakfast",
      meal_order: 1,
      notes: "",
      nutrition_meal_foods: [],
    };
    const prisma = {
      coach_profiles: {
        findFirst: jest.fn(async () => ({ id: COACH_A })),
      },
      client_profiles: {
        findUnique: jest.fn(async () => null),
      },
      nutrition_plans: {
        findFirst: jest.fn(async (args: { where: { id: string; coach_client: { coach_id: string } } }) =>
          args.where.coach_client.coach_id === COACH_A
            ? {
                id: NPLAN_ID,
                title: "Plan",
                description: "",
                is_active: true,
                created_at: new Date("2026-01-01T00:00:00Z"),
                nutrition_meals: [mealRow],
              }
            : null,
        ),
        findUnique: jest.fn(async () => ({ coach_client: { client_id: "client-1" } })),
      },
      nutrition_meals: {
        findFirst: jest.fn(async () => ({ id: "meal-1", meal_order: 1 })),
        aggregate: jest.fn(async () => ({ _max: { meal_order: 1 } })),
      },
      $transaction: jest.fn(async (cb: (tx: unknown) => unknown) =>
        cb({
          nutrition_meals: {
            aggregate: jest.fn(async () => ({ _max: { meal_order: 1 } })),
            update: jest.fn(async () => mealRow),
          },
        }),
      ),
    };
    const svc = new NutritionPlanService(prisma as never);

    await svc.updatePlanMeal("coach-user-1", NPLAN_ID, "meal-1", {}, "en");

    const warmed = await cache.CacheService.getJson(
      cache.cacheKeys.nutritionPlanItem(COACH_A, NPLAN_ID, "en"),
    );
    // With the userId/coachId mixup this would be null (loader 404 → drop).
    expect(warmed).not.toBeNull();
    expect(warmed).toMatchObject({ id: NPLAN_ID });
  });
});
