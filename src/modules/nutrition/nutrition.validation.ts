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

const MAX_PAGE_SIZE = 100;

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

export function parseListFoodsQuery(
  query: Record<string, unknown>,
  t: Translate = tFallback
): { result?: ListFoodsQuery; errors: string[] } {
  const errors: string[] = [];
  const filters: FoodFilters = {};

  if (query.search !== undefined) filters.search = String(query.search).trim() || undefined;
  if (query.categoryId !== undefined) filters.categoryId = String(query.categoryId) || undefined;

  if (query.isArchived !== undefined) {
    const parsed = parseBoolean(query.isArchived);
    if (parsed === null) {
      errors.push(t("invalid_is_archived"));
    } else {
      filters.isArchived = parsed;
    }
  }

  const ranges: Array<[unknown, NumericFilterKey, NumericFilterKey]> = [
    [query.minCalories, "minCalories", "maxCalories"],
    [query.minProtein, "minProtein", "maxProtein"],
    [query.minCarbs, "minCarbs", "maxCarbs"],
    [query.minFat, "minFat", "maxFat"],
    [query.maxCalories, "maxCalories", "minCalories"],
    [query.maxProtein, "maxProtein", "minProtein"],
    [query.maxCarbs, "maxCarbs", "minCarbs"],
    [query.maxFat, "maxFat", "minFat"],
  ];

  for (const [raw, rangeKey, oppositeKey] of ranges) {
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
      pageSize: pageSize ?? 20,
    },
    errors,
  };
}
