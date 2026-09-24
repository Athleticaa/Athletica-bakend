import { PrismaClient } from "@prisma/client";
import { injectable, inject } from "tsyringe";
import { PrismaClientToken } from "../../di/tokens";
import { ServiceError } from "../../lib/service-error";
import {
  todayDateOnly,
  toDateOnly,
  toCairoDateOnly,
  parseDateOnly,
  formatDateOnly,
  addDays,
  calcStreak,
  toFoodPayload,
  type FoodWithData,
} from "./nutrition.utils";
import type { HistoryQuery } from "./nutrition.validation";

// ============================================================================
// Response types
// ============================================================================

type TodayMealResponse = {
  meal_log_id: string;
  meal_id: string;
  meal_type: string;
  meal_order: number;
  notes: string;
  completed: boolean;
  completed_at: Date | null;
  foods: ReturnType<typeof toFoodPayload>[];
};

type PlanSummaryResponse = {
  id: string;
  title: string;
  description: string;
  is_active: boolean;
  created_at: Date;
  meal_count: number;
};

type PlanDetailResponse = PlanSummaryResponse & {
  meals: Array<{
    id: string;
    meal_type: string;
    meal_order: number;
    notes: string;
    foods: ReturnType<typeof toFoodPayload>[];
  }>;
};

type HistoryDayResponse = {
  date: string;
  total_meals: number;
  completed_meals: number;
  all_completed: boolean;
};

// ============================================================================
// Interface for DI
// ============================================================================

export interface INutritionClientService {
  getTodayMeals(userId: string, lang?: string): Promise<{ meals: TodayMealResponse[]; day_completed: boolean | null }>;
  getMyActivePlan(userId: string): Promise<{ plan: PlanSummaryResponse | null }>;
  getPlanDetails(userId: string, planId: string, lang?: string): Promise<{ plan: PlanDetailResponse }>;
  completeMeal(userId: string, mealLogId: string, lang?: string): Promise<{ meal_log: TodayMealResponse; day_completed: boolean }>;
  uncompleteMeal(userId: string, mealLogId: string, lang?: string): Promise<{ meal_log: TodayMealResponse; day_completed: boolean }>;
  getHistory(userId: string, query: HistoryQuery): Promise<{ history: HistoryDayResponse[] }>;
  getStreakSelf(userId: string): Promise<StreakResponse>;
  getStreakByCoachClient(coachUserId: string, coachClientId: string): Promise<StreakResponse>;
}

type StreakDayResponse = {
  date: string;
  status: "completed" | "missed";
  total_meals: number;
  completed_meals: number;
};

type StreakResponse = {
  client_id: string;
  coach_client_id: string;
  from: string;
  to: string;
  current_streak: number;
  longest_streak: number;
  total_completed: number;
  total_missed: number;
  rest_days: number;
  total_days: number;
  completion_rate: number;
  days: StreakDayResponse[];
};

@injectable()
export class NutritionClientService implements INutritionClientService {
  constructor(@inject(PrismaClientToken) private prisma: PrismaClient) {}

  // ==========================================================================
  // Helpers
  // ==========================================================================

  private async getClientProfileId(userId: string): Promise<string> {
    const profile = await this.prisma.client_profiles.findFirst({ where: { user_id: userId } });
    if (!profile) throw new ServiceError("client_profile_not_found", 404);
    return profile.id;
  }

  private async getActivePlan(clientId: string) {
    const plan = await this.prisma.nutrition_plans.findFirst({
      where: {
        coach_client: { client_id: clientId },
        is_active: true,
      },
      // Deterministic pick if multiple active plans ever exist (e.g. data anomaly)
      orderBy: { created_at: "desc" },
      include: {
        nutrition_meals: {
          orderBy: { meal_order: "asc" },
          include: { nutrition_meal_foods: { include: { food: { include: { category: true } } } } },
        },
      },
    });
    return plan;
  }

  private async ensurePlanActive(plan: { is_active: boolean; id: string }) {
    if (!plan.is_active) throw new ServiceError("no_active_plan_found", 404);
  }

  private isToday(date: Date): boolean {
    const today = todayDateOnly();
    return toDateOnly(date).getTime() === today.getTime();
  }

  private async getActivePlanSummary(clientId: string) {
    const plan = await this.prisma.nutrition_plans.findFirst({
      where: {
        coach_client: { client_id: clientId },
        is_active: true,
      },
      orderBy: { created_at: "desc" },
      include: { _count: { select: { nutrition_meals: true } } },
    });
    return plan;
  }

  private async createMealLogsForDate(clientId: string, planId: string, meals: Array<{ id: string }>, date: Date) {
    const dateOnly = toDateOnly(date);

    // Reconcile: only create logs for plan meals that don't have one yet, so
    // meals added to the plan after the first fetch still appear in "today"
    const existingLogs = await this.prisma.nutrition_meal_logs.findMany({
      where: { client_id: clientId, date: dateOnly, nutrition_plan_id: planId },
      select: { nutrition_meal_id: true },
    });
    const existingMealIds = new Set(existingLogs.map((l) => l.nutrition_meal_id));
    const missingMeals = meals.filter((m) => !existingMealIds.has(m.id));

    if (missingMeals.length === 0) return;

    // A meal may have been deleted between the caller's fetch and this point —
    // re-query the surviving meals so the FK can never fire (P2003 -> 500).
    const survivors = await this.prisma.nutrition_meals.findMany({
      where: { id: { in: missingMeals.map((m) => m.id) }, nutrition_plan_id: planId },
      select: { id: true },
    });
    if (survivors.length === 0) return;

    // Create meal logs for each surviving meal (ignore duplicates created concurrently)
    await this.prisma.nutrition_meal_logs.createMany({
      data: survivors.map((meal) => ({
        nutrition_plan_id: planId,
        nutrition_meal_id: meal.id,
        client_id: clientId,
        date: dateOnly,
        completed: false,
      })),
      skipDuplicates: true,
    });
  }

  private toMealLogResponse(
    log: {
      id: string;
      nutrition_meal_id: string;
      completed: boolean;
      completed_at: Date | null;
      nutrition_meal: {
        meal_type: string;
        meal_order: number;
        notes: string;
        nutrition_meal_foods: Array<FoodWithData>;
      };
    },
    lang?: string
  ): TodayMealResponse {
    return {
      meal_log_id: log.id,
      meal_id: log.nutrition_meal_id,
      meal_type: log.nutrition_meal.meal_type,
      meal_order: log.nutrition_meal.meal_order,
      notes: log.nutrition_meal.notes,
      completed: log.completed,
      completed_at: log.completed_at,
      foods: log.nutrition_meal.nutrition_meal_foods.map((f) => toFoodPayload(f, lang)),
    };
  }

  // ==========================================================================
  // US5: Client View Today's Meals
  // ==========================================================================

  async getTodayMeals(userId: string, lang?: string) {
    const clientId = await this.getClientProfileId(userId);
    const plan = await this.getActivePlan(clientId);

    if (!plan) {
      const assignment = await this.prisma.coach_clients.findFirst({
        where: { client_id: clientId },
        include: { coach: { include: { user: { select: { username: true, email: true } } } } },
      });
      const coach = assignment
        ? { id: assignment.coach.id, user: assignment.coach.user }
        : null;
      throw new ServiceError("no_active_plan_found", 404, { coach });
    }

    await this.ensurePlanActive(plan);

    const today = todayDateOnly();

    // Auto-create meal logs if they don't exist
    await this.createMealLogsForDate(clientId, plan.id, plan.nutrition_meals, today);

    // Fetch meal logs for today's plan
    const logs = await this.prisma.nutrition_meal_logs.findMany({
      where: { client_id: clientId, date: today, nutrition_plan_id: plan.id },
      include: {
        nutrition_meal: {
          include: { nutrition_meal_foods: { include: { food: { include: { category: true } } } } },
        },
      },
      orderBy: { nutrition_meal: { meal_order: "asc" } },
    });

    const meals = logs.map((log) => this.toMealLogResponse(log, lang));
    const day_completed = meals.length > 0 ? meals.every((m) => m.completed) : null;

    return { meals, day_completed };
  }

  async getMyActivePlan(userId: string) {
    const clientId = await this.getClientProfileId(userId);
    const plan = await this.getActivePlanSummary(clientId);

    if (!plan) {
      const assignment = await this.prisma.coach_clients.findFirst({
        where: { client_id: clientId },
        include: { coach: { include: { user: { select: { username: true, email: true } } } } },
      });
      const coach = assignment
        ? { id: assignment.coach.id, user: assignment.coach.user }
        : null;
      throw new ServiceError("no_active_plan_found", 404, { coach });
    }

    await this.ensurePlanActive(plan);

    return {
      plan: {
        id: plan.id,
        title: plan.title,
        description: plan.description,
        is_active: plan.is_active,
        created_at: plan.created_at,
        meal_count: plan._count.nutrition_meals,
      },
    };
  }

  async getPlanDetails(userId: string, planId: string, lang?: string) {
    const clientId = await this.getClientProfileId(userId);

    const plan = await this.prisma.nutrition_plans.findFirst({
      where: {
        id: planId,
        coach_client: { client_id: clientId },
        is_active: true,
      },
      include: {
        nutrition_meals: {
          orderBy: { meal_order: "asc" },
          include: { nutrition_meal_foods: { include: { food: { include: { category: true } } } } },
        },
      },
    });
    if (!plan) throw new ServiceError("plan_not_found", 404);

    return {
      plan: {
        id: plan.id,
        title: plan.title,
        description: plan.description,
        is_active: plan.is_active,
        created_at: plan.created_at,
        meal_count: plan.nutrition_meals.length,
        meals: plan.nutrition_meals.map((m) => ({
          id: m.id,
          meal_type: m.meal_type,
          meal_order: m.meal_order,
          notes: m.notes,
          foods: m.nutrition_meal_foods.map((f) => toFoodPayload(f, lang)),
        })),
      },
    };
  }

  // ==========================================================================
  // US6: Client Marks Meal Completed
  // ==========================================================================

  private async checkDayCompletion(clientId: string, planId: string, date: Date) {
    const dateOnly = toDateOnly(date);
    // Count total logs (not plan meals) so we only consider meals that were
    // actually tracked for this date.  If a meal was added to the plan after
    // logs were created, it won't have a log yet and shouldn't block completion.
    const totalLogs = await this.prisma.nutrition_meal_logs.count({
      where: { client_id: clientId, date: dateOnly, nutrition_plan_id: planId },
    });
    const completedLogs = await this.prisma.nutrition_meal_logs.count({
      where: { client_id: clientId, date: dateOnly, completed: true, nutrition_plan_id: planId },
    });
    return totalLogs > 0 && completedLogs >= totalLogs;
  }

  async completeMeal(userId: string, mealLogId: string, lang?: string) {
    const clientId = await this.getClientProfileId(userId);

    const log = await this.prisma.nutrition_meal_logs.findFirst({
      where: { id: mealLogId, client_id: clientId },
      include: {
        nutrition_meal: {
          include: { nutrition_meal_foods: { include: { food: { include: { category: true } } } } },
        },
      },
    });
    if (!log) throw new ServiceError("meal_log_not_found", 404);
    if (!this.isToday(log.date)) throw new ServiceError("meal_today_only", 400);

    const plan = await this.prisma.nutrition_plans.findUnique({
      where: { id: log.nutrition_plan_id },
      select: { id: true, is_active: true },
    });
    if (!plan) throw new ServiceError("plan_not_active", 400);
    await this.ensurePlanActive(plan);

    // Already completed — return as-is (preserve original completed_at)
    if (log.completed) {
      const day_completed = await this.checkDayCompletion(clientId, log.nutrition_plan_id, log.date);
      return { meal_log: this.toMealLogResponse(log, lang), day_completed };
    }

    // Mark as completed (set completed_at on first completion only)
    const updated = await this.prisma.nutrition_meal_logs.update({
      where: { id: mealLogId },
      data: {
        completed: true,
        completed_at: new Date(),
      },
      include: {
        nutrition_meal: {
          include: { nutrition_meal_foods: { include: { food: { include: { category: true } } } } },
        },
      },
    });

    const day_completed = await this.checkDayCompletion(clientId, log.nutrition_plan_id, log.date);

    return {
      meal_log: this.toMealLogResponse(updated, lang),
      day_completed,
    };
  }

  async uncompleteMeal(userId: string, mealLogId: string, lang?: string) {
    const clientId = await this.getClientProfileId(userId);

    const log = await this.prisma.nutrition_meal_logs.findFirst({
      where: { id: mealLogId, client_id: clientId },
      include: {
        nutrition_meal: {
          include: { nutrition_meal_foods: { include: { food: { include: { category: true } } } } },
        },
      },
    });
    if (!log) throw new ServiceError("meal_log_not_found", 404);
    if (!this.isToday(log.date)) throw new ServiceError("meal_today_only", 400);
    if (!log.completed) throw new ServiceError("meal_not_completed", 400);

    const plan = await this.prisma.nutrition_plans.findUnique({
      where: { id: log.nutrition_plan_id },
      select: { id: true, is_active: true },
    });
    if (!plan) throw new ServiceError("plan_not_active", 400);
    await this.ensurePlanActive(plan);

    const updated = await this.prisma.nutrition_meal_logs.update({
      where: { id: mealLogId },
      data: {
        completed: false,
        completed_at: null,
      },
      include: {
        nutrition_meal: {
          include: { nutrition_meal_foods: { include: { food: { include: { category: true } } } } },
        },
      },
    });

    const day_completed = await this.checkDayCompletion(clientId, log.nutrition_plan_id, log.date);

    return {
      meal_log: this.toMealLogResponse(updated, lang),
      day_completed,
    };
  }

  // ==========================================================================
  // US9: Client Views Completion History
  // ==========================================================================

  async getHistory(userId: string, query: HistoryQuery) {
    const clientId = await this.getClientProfileId(userId);

    const fromDate = parseDateOnly(query.from);
    const toDate = parseDateOnly(query.to);
    if (!fromDate || !toDate) throw new ServiceError("start_date_invalid", 400);

    // Group all logs by date to get total meals and completed meals per day.
    // Only days with at least one log are returned (empty dates omitted).
    const [totalByDate, completedByDate] = await Promise.all([
      this.prisma.nutrition_meal_logs.groupBy({
        by: ["date"],
        where: {
          client_id: clientId,
          date: { gte: fromDate, lte: toDate },
        },
        _count: { _all: true },
      }),
      this.prisma.nutrition_meal_logs.groupBy({
        by: ["date"],
        where: {
          client_id: clientId,
          completed: true,
          date: { gte: fromDate, lte: toDate },
        },
        _count: { _all: true },
      }),
    ]);

    const completedMap = new Map<string, number>();
    for (const entry of completedByDate) {
      completedMap.set(formatDateOnly(entry.date), entry._count._all);
    }

    // Only include days that have at least one log (totalByDate entries).
    const history: HistoryDayResponse[] = totalByDate
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .map((entry) => {
        const dateKey = formatDateOnly(entry.date);
        const totalMeals = entry._count._all;
        const completedMeals = completedMap.get(dateKey) ?? 0;
        return {
          date: dateKey,
          total_meals: totalMeals,
          completed_meals: completedMeals,
          all_completed: totalMeals > 0 && completedMeals >= totalMeals,
        };
      });

    return { history };
  }

  // ==========================================================================
  // Streak: assignment start → today (no rest state for nutrition)
  // ==========================================================================

  private async resolveAssignmentByClient(clientId: string) {
    const assignment = await this.prisma.coach_clients.findFirst({ where: { client_id: clientId } });
    if (!assignment) throw new ServiceError("assignment_not_found", 404);
    return assignment;
  }

  private async resolveAssignmentForCoach(coachUserId: string, coachClientId: string) {
    const coach = await this.prisma.coach_profiles.findFirst({ where: { user_id: coachUserId } });
    if (!coach) throw new ServiceError("coach_profile_not_found", 404);
    const assignment = await this.prisma.coach_clients.findFirst({
      where: { id: coachClientId, coach_id: coach.id },
    });
    if (!assignment) throw new ServiceError("client_not_assigned_to_coach", 404);
    return assignment;
  }

  async getStreakSelf(userId: string): Promise<StreakResponse> {
    const clientId = await this.getClientProfileId(userId);
    const assignment = await this.resolveAssignmentByClient(clientId);
    return this.buildStreak(assignment.id, clientId, toCairoDateOnly(new Date(assignment.created_at)));
  }

  async getStreakByCoachClient(coachUserId: string, coachClientId: string): Promise<StreakResponse> {
    const assignment = await this.resolveAssignmentForCoach(coachUserId, coachClientId);
    return this.buildStreak(assignment.id, assignment.client_id, toCairoDateOnly(new Date(assignment.created_at)));
  }

  private async buildStreak(coachClientId: string, clientId: string, rangeStart: Date): Promise<StreakResponse> {
    const today = todayDateOnly();
    // Guard against future-dated assignments (clock skew): clamp to a 1-day window.
    if (rangeStart.getTime() > today.getTime()) rangeStart = today;

    const logs = await this.prisma.nutrition_meal_logs.findMany({
      where: { client_id: clientId, date: { gte: rangeStart, lte: today } },
      select: { date: true, completed: true },
    });

    const byDate = new Map<string, { total: number; done: number }>();
    for (const log of logs) {
      const key = formatDateOnly(log.date);
      const bucket = byDate.get(key);
      if (bucket) {
        bucket.total += 1;
        if (log.completed) bucket.done += 1;
      } else {
        byDate.set(key, { total: 1, done: log.completed ? 1 : 0 });
      }
    }

    const days: StreakDayResponse[] = [];
    const statuses: Array<"completed" | "missed"> = [];
    for (let cursor = new Date(rangeStart); cursor.getTime() <= today.getTime(); cursor = addDays(cursor, 1)) {
      const dateKey = formatDateOnly(cursor);
      const bucket = byDate.get(dateKey);
      const total = bucket?.total ?? 0;
      const done = bucket?.done ?? 0;
      // Days with no logs count as missed (nothing tracked = nothing completed).
      const completed = total > 0 && done >= total;
      statuses.push(completed ? "completed" : "missed");
      days.push({ date: dateKey, status: completed ? "completed" : "missed", total_meals: total, completed_meals: done });
    }

    return {
      client_id: clientId,
      coach_client_id: coachClientId,
      from: formatDateOnly(rangeStart),
      to: formatDateOnly(today),
      ...calcStreak(statuses),
      days,
    };
  }
}
