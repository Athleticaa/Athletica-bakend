export interface ExerciseFilters {
  search?: string;
  primaryMuscle?: string;
  secondaryMuscle?: string;
  equipment?: string;
  difficulty?: string;
  exerciseType?: string;
  movementPattern?: string;
  workoutLocation?: string;
  priority?: string;
  isDefault?: boolean;
  goal?: string;
  tag?: string;
  classification?: string;
}

export interface ListExercisesQuery {
  filters: ExerciseFilters;
  page: number;
  pageSize: number;
}

const MAX_PAGE_SIZE = 100;

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

export function parseListExercisesQuery(
  query: Record<string, unknown>,
  t: (key: string) => string = tFallback
): { result?: ListExercisesQuery; errors: string[] } {
  const errors: string[] = [];
  const filters: ExerciseFilters = {};

  if (query.search !== undefined) filters.search = String(query.search).trim() || undefined;
  if (query.primaryMuscle !== undefined) filters.primaryMuscle = String(query.primaryMuscle) || undefined;
  if (query.secondaryMuscle !== undefined) filters.secondaryMuscle = String(query.secondaryMuscle) || undefined;
  if (query.equipment !== undefined) filters.equipment = String(query.equipment) || undefined;
  if (query.difficulty !== undefined) filters.difficulty = String(query.difficulty) || undefined;
  if (query.exerciseType !== undefined) filters.exerciseType = String(query.exerciseType) || undefined;
  if (query.movementPattern !== undefined) filters.movementPattern = String(query.movementPattern) || undefined;
  if (query.workoutLocation !== undefined) filters.workoutLocation = String(query.workoutLocation) || undefined;
  if (query.priority !== undefined) filters.priority = String(query.priority) || undefined;
  if (query.goal !== undefined) filters.goal = String(query.goal) || undefined;
  if (query.tag !== undefined) filters.tag = String(query.tag) || undefined;
  if (query.classification !== undefined) filters.classification = String(query.classification) || undefined;

  if (query.isDefault !== undefined) {
    const parsed = parseBoolean(query.isDefault);
    if (parsed === null) {
      errors.push(t("invalid_is_default"));
    } else {
      filters.isDefault = parsed;
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
