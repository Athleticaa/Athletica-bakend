import { parseDateOnly } from "./nutrition.utils";
import { config } from "../../config";

export interface FoodFilters {
  search?: string;
  categoryId?: string;
  isArchived?: boolean;
  minCalories?: number;
  maxCalories?: number;
  minProtein?: number;
  maxProtein?: number;
  minCarbs?: number;
  maxCarbs?: number;
  minFat?: number;
  maxFat?: number;
}

export interface ListFoodsQuery {
  filters: FoodFilters;
  page: number;
  pageSize: number;
}

// ============================================================================
// Shared base interfaces used across all nutrition endpoints
// ============================================================================

export interface PaginatedQuery {
  page: number;
  pageSize: number;
}

export interface PaginatedResult {
  result?: PaginatedQuery;
  errors: string[];
}

const MAX_PAGE_SIZE = config.pagination.maxPageSize;
const MAX_HISTORY_DAYS = config.history.maxDays;

type Translate = (key: string, options?: Record<string, unknown>) => string;
type NumericFilterKey =
  | "minCalories"
  | "maxCalories"
  | "minProtein"
  | "maxProtein"
  | "minCarbs"
  | "maxCarbs"
  | "minFat"
  | "maxFat";

function tFallback(key: string): string {
  return key;
}

function parsePositiveInt(value: unknown): number | null {
  if (Array.isArray(value)) return NaN;
  if (typeof value !== "string" || value.trim() === "") return null;
  const num = Number(value);
  if (!Number.isInteger(num) || num < 1) return NaN;
  return num;
}

function parseBoolean(value: unknown): boolean | null {
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function parseNonNegativeNumber(value: unknown): number | null {
  if (Array.isArray(value)) return NaN;
  if (typeof value !== "string" || value.trim() === "") return null;
  const num = Number(value);
  if (Number.isNaN(num) || num < 0) return NaN;
  return num;
}

// ============================================================================
// Shared helpers: UUID validation & pagination parsing
// ============================================================================

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

export function parsePaginatedQuery(
  query: Record<string, unknown>,
  t: Translate = tFallback
): PaginatedResult {
  const errors: string[] = [];
  const page = parsePositiveInt(query.page ?? "1");
  const pageSize = parsePositiveInt(query.pageSize ?? "20");

  if (Number.isNaN(page)) errors.push(t("invalid_page"));
  if (Number.isNaN(pageSize) || (pageSize !== null && pageSize > MAX_PAGE_SIZE)) {
    errors.push(t("invalid_page_size"));
  }

  if (errors.length > 0) return { errors };

  return {
    result: {
      page: page ?? 1,
      pageSize: pageSize ?? config.pagination.defaultPageSize,
    },
    errors,
  };
}

export function parseListFoodsQuery(
  query: Record<string, unknown>,
  t: Translate = tFallback
): { result?: ListFoodsQuery; errors: string[] } {
  const errors: string[] = [];
  const filters: FoodFilters = {};

  if (query.search !== undefined) filters.search = String(query.search).trim() || undefined;
  if (query.categoryId !== undefined) {
    filters.categoryId = String(query.categoryId) || undefined;
    if (filters.categoryId && !isValidUuid(filters.categoryId)) {
      errors.push(t("invalid_uuid"));
    }
  }

  if (query.isArchived !== undefined) {
    const parsed = parseBoolean(query.isArchived);
    if (parsed === null) {
      errors.push(t("invalid_is_archived"));
    } else {
      filters.isArchived = parsed;
    }
  }

  const ranges: Array<[unknown, NumericFilterKey]> = [
    [query.minCalories, "minCalories"],
    [query.minProtein, "minProtein"],
    [query.minCarbs, "minCarbs"],
    [query.minFat, "minFat"],
    [query.maxCalories, "maxCalories"],
    [query.maxProtein, "maxProtein"],
    [query.maxCarbs, "maxCarbs"],
    [query.maxFat, "maxFat"],
  ];

  for (const [raw, rangeKey] of ranges) {
    if (raw === undefined) continue;
    const parsed = parseNonNegativeNumber(raw);
    if (Number.isNaN(parsed)) {
      errors.push(t("invalid_range_value", { field: rangeKey }));
    } else if (parsed !== null) {
      filters[rangeKey] = parsed;
    }
  }

  if (errors.length === 0) {
    const rangePairs: Array<[NumericFilterKey, NumericFilterKey]> = [
      ["minCalories", "maxCalories"],
      ["minProtein", "maxProtein"],
      ["minCarbs", "maxCarbs"],
      ["minFat", "maxFat"],
    ];
    for (const [minKey, maxKey] of rangePairs) {
      if (filters[minKey] !== undefined && filters[maxKey] !== undefined && filters[minKey]! > filters[maxKey]!) {
        errors.push(t("invalid_range"));
        break;
      }
    }
  }

  const page = parsePositiveInt(query.page ?? "1");
  const pageSize = parsePositiveInt(query.pageSize ?? "20");

  if (Number.isNaN(page)) errors.push(t("invalid_page"));
  if (Number.isNaN(pageSize) || (pageSize !== null && pageSize > MAX_PAGE_SIZE)) errors.push(t("invalid_page_size"));

  if (errors.length > 0) return { errors };

  return {
    result: {
      filters,
      page: page ?? 1,
      pageSize: pageSize ?? config.pagination.defaultPageSize,
    },
    errors,
  };
}

// ============================================================================
// Template DTOs & validation (US1)
// ============================================================================

export interface CreateTemplateInput {
  title: string;
  description: string;
}

export interface UpdateTemplateInput {
  title?: string;
  description?: string;
}

export function validateCreateTemplate(
  input: CreateTemplateInput,
  t: Translate = tFallback
): string[] {
  const errors: string[] = [];
  const { title, description } = input ?? {};

  if (!title || typeof title !== "string" || title.trim().length === 0) {
    errors.push(t("template_title_required"));
  } else if (title.trim().length > 100) {
    errors.push(t("template_title_too_long"));
  }

  if (typeof description !== "string" || description.trim().length === 0) {
    errors.push(t("template_description_required"));
  } else if (description.trim().length > 500) {
    errors.push(t("template_description_too_long"));
  }

  return errors;
}

export function validateUpdateTemplate(
  input: UpdateTemplateInput,
  t: Translate = tFallback
): string[] {
  const errors: string[] = [];
  const { title, description } = input ?? {};

  if (title === undefined && description === undefined) {
    errors.push(t("invalid_request"));
  }

  if (title !== undefined) {
    if (typeof title !== "string" || title.trim().length === 0) {
      errors.push(t("template_title_required"));
    } else if (title.trim().length > 100) {
      errors.push(t("template_title_too_long"));
    }
  }

  if (description !== undefined) {
    if (typeof description !== "string" || description.trim().length === 0) {
      errors.push(t("template_description_required"));
    } else if (description.trim().length > 500) {
      errors.push(t("template_description_too_long"));
    }
  }

  return errors;
}

// ============================================================================
// Template Meal DTOs & validation (US2)
// ============================================================================

export const MEAL_TYPES = ["breakfast", "lunch", "snack", "dinner", "snack2"] as const;
export type MealType = (typeof MEAL_TYPES)[number];

export interface CreateMealInput {
  meal_type: string;
  meal_order?: number;
  notes?: string;
}

export interface UpdateMealInput {
  meal_type?: string;
  meal_order?: number;
  notes?: string;
}

export interface ReorderMealsInput {
  meal_orders: Array<{ meal_id: string; meal_order: number }>;
}

export function validateCreateMeal(
  input: CreateMealInput,
  t: Translate = tFallback
): string[] {
  const errors: string[] = [];
  const { meal_type, meal_order, notes } = input ?? {};

  if (!meal_type || typeof meal_type !== "string" || meal_type.trim().length === 0) {
    errors.push(t("meal_type_required"));
  } else if (!MEAL_TYPES.includes(meal_type as MealType)) {
    errors.push(t("meal_type_invalid", { types: MEAL_TYPES.join(", ") }));
  }

  if (meal_order !== undefined && (typeof meal_order !== "number" || !Number.isInteger(meal_order) || meal_order < 1)) {
    errors.push(t("meal_order_invalid"));
  }

  if (notes !== undefined) {
    if (typeof notes !== "string") {
      errors.push(t("meal_notes_invalid"));
    } else if (notes.trim().length > 500) {
      errors.push(t("meal_notes_too_long"));
    }
  }

  return errors;
}

export function validateUpdateMeal(
  input: UpdateMealInput,
  t: Translate = tFallback
): string[] {
  const errors: string[] = [];
  const { meal_type, meal_order, notes } = input ?? {};

  if (meal_type === undefined && meal_order === undefined && notes === undefined) {
    errors.push(t("invalid_request"));
  }

  if (meal_type !== undefined) {
    if (typeof meal_type !== "string" || meal_type.trim().length === 0) {
      errors.push(t("meal_type_required"));
    } else if (!MEAL_TYPES.includes(meal_type as MealType)) {
      errors.push(t("meal_type_invalid", { types: MEAL_TYPES.join(", ") }));
    }
  }

  if (meal_order !== undefined) {
    if (typeof meal_order !== "number" || !Number.isInteger(meal_order) || meal_order < 1) {
      errors.push(t("meal_order_invalid"));
    }
  }

  if (notes !== undefined) {
    if (typeof notes !== "string") {
      errors.push(t("meal_notes_invalid"));
    } else if (notes.trim().length > 500) {
      errors.push(t("meal_notes_too_long"));
    }
  }

  return errors;
}

export function validateReorderMeals(
  input: ReorderMealsInput,
  t: Translate = tFallback
): string[] {
  const errors: string[] = [];
  const { meal_orders } = input ?? {};

  if (!meal_orders || !Array.isArray(meal_orders) || meal_orders.length === 0) {
    errors.push(t("meal_orders_required"));
    return errors;
  }

  const seen = new Set<string>();
  for (const item of meal_orders) {
    if (!item || typeof item.meal_id !== "string" || !isValidUuid(item.meal_id)) {
      errors.push(t("meal_orders_invalid"));
      break;
    }
    if (seen.has(item.meal_id)) {
      errors.push(t("meal_orders_invalid"));
      break;
    }
    seen.add(item.meal_id);
    if (
      typeof item.meal_order !== "number" ||
      !Number.isInteger(item.meal_order) ||
      item.meal_order < 1
    ) {
      errors.push(t("meal_orders_invalid"));
      break;
    }
  }

  // Orders must be a permutation of 1..N (no duplicates, no gaps)
  if (errors.length === 0) {
    const expected = new Set(meal_orders.map((_, i) => i + 1));
    const actual = new Set(meal_orders.map((m) => m.meal_order));
    for (const order of expected) {
      if (!actual.has(order)) {
        errors.push(t("meal_orders_invalid"));
        break;
      }
    }
  }

  return errors;
}

// ============================================================================
// Template Food DTOs & validation (US3)
// ============================================================================

export interface CreateTemplateFoodInput {
  food_id: string;
  quantity: number;
}

export interface UpdateTemplateFoodInput {
  quantity: number;
}

export function validateCreateTemplateFood(
  input: CreateTemplateFoodInput,
  t: Translate = tFallback
): string[] {
  const errors: string[] = [];
  const { food_id, quantity } = input ?? {};

  if (!food_id || typeof food_id !== "string" || !isValidUuid(food_id)) {
    errors.push(t("food_id_required"));
  }

  if (quantity === undefined || typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0) {
    errors.push(t("default_quantity_required"));
  }

  return errors;
}

export function validateUpdateTemplateFood(
  input: UpdateTemplateFoodInput,
  t: Translate = tFallback
): string[] {
  const errors: string[] = [];
  const { quantity } = input ?? {};

  if (quantity === undefined) {
    errors.push(t("invalid_request"));
  } else if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0) {
    errors.push(t("default_quantity_invalid"));
  }

  return errors;
}

// ============================================================================
// Plan DTOs & validation (US4)
// ============================================================================

export interface AssignPlanInput {
  coach_client_id: string;
  title: string;
  description: string;
}

export interface ListClientPlansQuery {
  page: number;
  pageSize: number;
  clientId?: string;
  isActive?: boolean;
}

export function validateAssignPlan(
  input: AssignPlanInput,
  t: Translate = tFallback
): string[] {
  const errors: string[] = [];
  const { coach_client_id, title, description } = input ?? {};

  if (!coach_client_id || typeof coach_client_id !== "string" || !isValidUuid(coach_client_id)) {
    errors.push(t("coach_client_id_required"));
  }

  if (!title || typeof title !== "string" || title.trim().length === 0) {
    errors.push(t("plan_title_required"));
  } else if (title.trim().length > 100) {
    errors.push(t("plan_title_too_long"));
  }

  if (description !== undefined && typeof description !== "string") {
    errors.push(t("plan_description_invalid"));
  } else if (description && typeof description === "string" && description.trim().length > 500) {
    errors.push(t("plan_description_too_long"));
  }

  return errors;
}

export function parseListClientPlansQuery(
  query: Record<string, unknown>,
  t: Translate = tFallback
): { result?: ListClientPlansQuery; errors: string[] } {
  const page = parsePositiveInt(query.page ?? "1");
  const pageSize = parsePositiveInt(query.pageSize ?? "20");
  const errors: string[] = [];

  if (Number.isNaN(page)) errors.push(t("invalid_page"));
  if (Number.isNaN(pageSize) || (pageSize !== null && pageSize > MAX_PAGE_SIZE)) {
    errors.push(t("invalid_page_size"));
  }

  let clientId: string | undefined;
  if (query.client_id !== undefined) {
    clientId = String(query.client_id) || undefined;
    if (clientId && !isValidUuid(clientId)) {
      errors.push(t("invalid_client_id"));
    }
  }

  let isActive: boolean | undefined;
  if (query.is_active !== undefined) {
    const parsed = parseBoolean(query.is_active);
    if (parsed === null) {
      errors.push(t("invalid_is_active"));
    } else {
      isActive = parsed;
    }
  }

  if (errors.length > 0) return { errors };

  return {
    result: { page: page ?? 1, pageSize: pageSize ?? config.pagination.defaultPageSize, clientId, isActive },
    errors,
  };
}

// ============================================================================
// Client View DTOs & validation (US5/US6/US9)
// ============================================================================

export interface HistoryQuery {
  from: string;
  to: string;
}

export function validateHistoryQuery(
  input: HistoryQuery,
  t: Translate = tFallback
): string[] {
  const errors: string[] = [];
  const { from, to } = input ?? {};

  if (!from || typeof from !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    errors.push(t("history_from_invalid"));
  }

  if (!to || typeof to !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    errors.push(t("history_to_invalid"));
  }

  if (from && to && /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    const f = parseDateOnly(from);
    const t2 = parseDateOnly(to);
    if (f && t2 && f > t2) {
      errors.push(t("end_date_before_start_date"));
    }
    if (f && t2) {
      const days = Math.round((t2.getTime() - f.getTime()) / 86_400_000);
      if (days > MAX_HISTORY_DAYS) {
        errors.push(t("history_range_too_long", { max_days: MAX_HISTORY_DAYS }));
      }
    }
  }

  return errors;
}
