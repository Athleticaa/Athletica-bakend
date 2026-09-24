// ============================================================================
// Shared helper types & utilities for the nutrition module
// ============================================================================

import { config } from "../../config";
import { ServiceError } from "../../lib/service-error";

/**
 * Standard pagination metadata returned by every list endpoint.
 */
export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/**
 * Builds a consistent pagination response shape.
 */
export function buildPagination(page: number, pageSize: number, total: number): PaginationMeta {
  return {
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  };
}

/**
 * Wraps two already-executed promises (items + total count) into a
 * consistent paginated payload ({ items, pagination }) used by all
 * list endpoints. Keeps query building in the caller for full typing.
 */
export async function paginate<T>(
  itemsPromise: Promise<T[]>,
  countPromise: Promise<number>,
  query: { page: number; pageSize: number }
): Promise<{ items: T[]; pagination: PaginationMeta }> {
  const [items, total] = await Promise.all([itemsPromise, countPromise]);
  return { items, pagination: buildPagination(query.page, query.pageSize, total) };
}

// ============================================================================
// Food payload mapping (enriched with joined nutrition data)
// ============================================================================

/**
 * Rounds a number to one decimal place (macro values in API responses).
 */
export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export type FoodWithData = {
  id: string;
  food_id: string;
  quantity: number;
  food: {
    name: string;
    name_en: string;
    name_ar: string;
    serving_unit: string;
    serving_unit_en: string;
    serving_unit_ar: string;
    base_grams: number;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    category_id?: string;
    is_archived?: boolean;
    category?: {
      id: string;
      name: string;
      name_en: string;
      name_ar: string;
    } | null;
  };
};

/**
 * Maps a meal-food row (with its `food` relation included) into the enriched
 * API payload. Nutrition values are scaled linearly by
 * `quantity / base_grams` (e.g. 150g of a 389kcal/100g food -> 583.5kcal).
 *
 * Now returns BOTH languages for every food in every context (no lang filtering).
 * `lang` is kept for backwards compat (still sets legacy `food_name`) but
 * `food_name_en` / `food_name_ar` / `name_en` / `name_ar` and
 * `serving_unit_en` / `serving_unit_ar` are always present.
 */
export function toFoodPayload(f: FoodWithData, lang?: string) {
  if (f.food.base_grams <= 0) {
    throw new ServiceError("internal_server_error", 500);
  }
  const scale = f.quantity / f.food.base_grams;
  const foodName = lang === "ar" ? f.food.name_ar : lang === "en" ? f.food.name_en : f.food.name;
  const category = f.food.category;
  return {
    id: f.id,
    food_id: f.food_id,
    // legacy single-language field (kept for compat)
    food_name: foodName,
    // bilingual — always returned
    food_name_en: f.food.name_en,
    food_name_ar: f.food.name_ar,
    name: f.food.name,
    name_en: f.food.name_en,
    name_ar: f.food.name_ar,
    quantity: f.quantity,
    serving_unit: f.food.serving_unit,
    serving_unit_en: f.food.serving_unit_en ?? f.food.serving_unit,
    serving_unit_ar: f.food.serving_unit_ar ?? f.food.serving_unit,
    calories: round1(f.food.calories * scale),
    protein: round1(f.food.protein * scale),
    carbs: round1(f.food.carbs * scale),
    fat: round1(f.food.fat * scale),
    ...(category
      ? {
          category: {
            id: category.id,
            name: category.name,
            name_en: category.name_en,
            name_ar: category.name_ar,
          },
        }
      : {}),
  };
}

// ============================================================================
// Date utilities for daily-repeating nutrition plans
//
// All date-only values are normalized to UTC midnight so they round-trip
// losslessly through Prisma `@db.Date` fields (which are stored as UTC).
// Comparisons and writes are therefore timezone-stable regardless of the
// server's local offset.
//
// The concept of "today" is anchored to the Africa/Cairo timezone (UTC+2,
// UTC+3 during Egyptian daylight saving) so clients in Egypt/Saudi never see
// yesterday's meals between midnight and 3 AM local time.
// ============================================================================

const CAIRO_TZ = config.timezone;
const cairoDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: CAIRO_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Returns a Date truncated to UTC midnight (YYYY-MM-DD only, no time).
 */
export function toDateOnly(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Returns today's calendar date in the Africa/Cairo timezone, normalized to
 * UTC midnight so it can be compared directly with stored `@db.Date` values.
 */
export function todayDateOnly(): Date {
  const cairoDate = cairoDateFormatter.format(new Date());
  return parseDateOnly(cairoDate)!;
}

/**
 * Truncates an arbitrary timestamp to its Africa/Cairo calendar day,
 * normalized to UTC midnight. Use this (instead of `toDateOnly`, which
 * truncates in UTC) for range bounds that must align with `todayDateOnly()`.
 */
export function toCairoDateOnly(date: Date): Date {
  return parseDateOnly(cairoDateFormatter.format(date))!;
}

/**
 * Formats a Date as "YYYY-MM-DD" string (useful for API responses & logs).
 */
export function formatDateOnly(date: Date): string {
  const d = toDateOnly(date);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Parses a "YYYY-MM-DD" string into a Date at UTC midnight.
 * Returns null if the string is not a valid date.
 */
export function parseDateOnly(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (
    date.getUTCFullYear() !== Number(y) ||
    date.getUTCMonth() !== Number(m) - 1 ||
    date.getUTCDate() !== Number(d)
  ) {
    return null;
  }
  return date;
}

/**
 * Returns the number of calendar days between two date-only values (>= 0).
 */
export function daysBetween(from: Date, to: Date): number {
  const start = toDateOnly(from).getTime();
  const end = toDateOnly(to).getTime();
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

/**
 * Adds N calendar days to a date-only value and returns the new date.
 */
export function addDays(date: Date, days: number): Date {
  const d = toDateOnly(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

// ============================================================================
// Streak calculation (shared by workout + nutrition streak endpoints)
//
// Input is an ascending (oldest → newest) list of per-day statuses where
// "rest" marks a scheduled rest day (workout only). Rest days are skipped:
// they neither break nor extend a run and are excluded from the
// completion-rate denominator.
//
// "today" is always the last element. A trailing "missed" does not zero
// `current_streak` — counting falls back to the run ending yesterday —
// but the day itself still counts as missed in the totals.
// ============================================================================

export type StreakStatus = "completed" | "missed" | "rest";

export interface StreakSummary {
  current_streak: number;
  longest_streak: number;
  total_completed: number;
  total_missed: number;
  rest_days: number;
  total_days: number;
  completion_rate: number;
}

export function calcStreak(statuses: StreakStatus[]): StreakSummary {
  let longest = 0;
  let run = 0;
  let completed = 0;
  let missed = 0;
  let rest = 0;

  for (const s of statuses) {
    if (s === "rest") {
      rest += 1;
      continue;
    }
    if (s === "completed") {
      completed += 1;
      run += 1;
      if (run > longest) longest = run;
    } else {
      missed += 1;
      run = 0;
    }
  }

  // Current streak: run ending today; if today itself is missed, fall back
  // to the run ending yesterday (trailing rest days are skipped first).
  let current = 0;
  let idx = statuses.length - 1;
  while (idx >= 0 && statuses[idx] === "rest") idx--;
  if (idx >= 0 && statuses[idx] === "missed") idx--; // today pending → start from yesterday
  while (idx >= 0 && statuses[idx] !== "missed") {
    if (statuses[idx] === "completed") current += 1;
    idx--;
  }

  const total = statuses.length;
  const denominator = total - rest;
  const completion_rate = denominator > 0 ? Math.round((completed / denominator) * 100) / 100 : 0;

  return {
    current_streak: current,
    longest_streak: longest,
    total_completed: completed,
    total_missed: missed,
    rest_days: rest,
    total_days: total,
    completion_rate,
  };
}
