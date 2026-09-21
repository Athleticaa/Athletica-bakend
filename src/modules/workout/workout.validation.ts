const MAX_PAGE_SIZE = 100;

type Translate = (key: string, options?: Record<string, unknown>) => string;

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

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

export interface ExerciseFilters {
  search?: string;
  bodyPart?: string;
  target?: string;
  secondaryMuscle?: string;
  equipment?: string;
  difficulty?: string;
  muscleGroup?: string;
  compound?: boolean;
  unilateral?: boolean;
}

export interface ListExercisesQuery {
  filters: ExerciseFilters;
  page: number;
  pageSize: number;
}

export function parseListExercisesQuery(
  query: Record<string, unknown>,
  t: Translate = tFallback
): { result?: ListExercisesQuery; errors: string[] } {
  const errors: string[] = [];
  const filters: ExerciseFilters = {};

  if (query.search !== undefined) filters.search = String(query.search).trim() || undefined;
  if (query.bodyPart !== undefined) filters.bodyPart = String(query.bodyPart).trim() || undefined;
  if (query.target !== undefined) filters.target = String(query.target).trim() || undefined;
  if (query.secondaryMuscle !== undefined) filters.secondaryMuscle = String(query.secondaryMuscle).trim() || undefined;
  if (query.equipment !== undefined) filters.equipment = String(query.equipment).trim() || undefined;
  if (query.difficulty !== undefined) filters.difficulty = String(query.difficulty).trim() || undefined;
  if (query.muscleGroup !== undefined) filters.muscleGroup = String(query.muscleGroup).trim() || undefined;

  for (const key of ["compound", "unilateral"] as const) {
    if (query[key] !== undefined) {
      const parsed = parseBoolean(query[key]);
      if (parsed === null) errors.push(`invalid_${key}`);
      else filters[key] = parsed;
    }
  }

  const page = parsePositiveInt(query.page ?? "1");
  const pageSize = parsePositiveInt(query.pageSize ?? "20");

  if (Number.isNaN(page)) errors.push(t("invalid_page"));
  if (Number.isNaN(pageSize) || (pageSize !== null && pageSize > MAX_PAGE_SIZE)) errors.push(t("invalid_page_size"));

  if (errors.length > 0) return { errors };
  return { result: { filters, page: page ?? 1, pageSize: pageSize ?? 20 }, errors };
}

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

export interface CreateDayInput {
  title: string;
  note?: string;
}

export interface UpdateDayInput {
  title?: string;
  day_number?: number;
  is_rest?: boolean;
  note?: string;
}

export interface ReorderDaysInput {
  day_ids: string[];
}

export function validateCreateDay(
  input: CreateDayInput,
  t: Translate = tFallback
): string[] {
  const errors: string[] = [];
  const { title, note } = input ?? {};

  if (!title || typeof title !== "string" || title.trim().length === 0) {
    errors.push(t("day_title_required"));
  } else if (title.trim().length > 100) {
    errors.push(t("day_title_too_long"));
  }

  if (note !== undefined && typeof note !== "string") {
    errors.push(t("invalid_note"));
  }

  return errors;
}

export function validateUpdateDay(
  input: UpdateDayInput,
  t: Translate = tFallback
): string[] {
  const errors: string[] = [];
  const { title, day_number, is_rest, note } = input ?? {};

  if (title === undefined && day_number === undefined && is_rest === undefined && note === undefined) {
    errors.push(t("invalid_request"));
  }

  if (title !== undefined) {
    if (typeof title !== "string" || title.trim().length === 0) {
      errors.push(t("day_title_required"));
    } else if (title.trim().length > 100) {
      errors.push(t("day_title_too_long"));
    }
  }

  if (day_number !== undefined) {
    if (typeof day_number !== "number" || !Number.isInteger(day_number) || day_number < 1) {
      errors.push(t("day_number_invalid"));
    }
  }

  if (is_rest !== undefined && typeof is_rest !== "boolean") {
    errors.push(t("is_rest_invalid"));
  }

  if (note !== undefined && typeof note !== "string") {
    errors.push(t("invalid_note"));
  }

  return errors;
}

export function validateReorderDays(
  input: ReorderDaysInput,
  t: Translate = tFallback
): string[] {
  const errors: string[] = [];
  const { day_ids } = input ?? {};

  if (!Array.isArray(day_ids) || day_ids.length === 0) {
    errors.push(t("day_ids_required"));
  } else {
    const seen = new Set<string>();
    for (const id of day_ids) {
      if (typeof id !== "string" || !isValidUuid(id)) {
        errors.push(t("invalid_uuid"));
      } else if (seen.has(id)) {
        errors.push(t("duplicate_day_id"));
      } else {
        seen.add(id);
      }
    }
  }

  return errors;
}

export interface CreateTemplateExerciseInput {
  exercise_id: string;
  exercise_order?: number;
  notes?: string;
}

export interface UpdateTemplateExerciseInput {
  exercise_order?: number;
  notes?: string;
}

export function validateCreateTemplateExercise(
  input: CreateTemplateExerciseInput,
  t: Translate = tFallback
): string[] {
  const errors: string[] = [];
  const { exercise_id, exercise_order } = input ?? {};

  if (!exercise_id || !isValidUuid(exercise_id)) {
    errors.push(t("invalid_exercise_id"));
  }

  if (exercise_order !== undefined && (typeof exercise_order !== "number" || !Number.isInteger(exercise_order) || exercise_order < 1)) {
    errors.push(t("exercise_order_invalid"));
  }

  return errors;
}

export function validateUpdateTemplateExercise(
  input: UpdateTemplateExerciseInput,
  t: Translate = tFallback
): string[] {
  const errors: string[] = [];
  const { exercise_order, notes } = input ?? {};

  if (exercise_order === undefined && notes === undefined) {
    errors.push(t("invalid_request"));
  }

  if (exercise_order !== undefined && (typeof exercise_order !== "number" || !Number.isInteger(exercise_order) || exercise_order < 1)) {
    errors.push(t("exercise_order_invalid"));
  }

  return errors;
}

export interface AssignPlanInput {
  coach_client_id: string;
  title?: string;
  description?: string;
}

export interface UpdatePlanInput {
  title?: string;
  description?: string;
}

export function validateAssignPlan(
  input: AssignPlanInput,
  t: Translate = tFallback
): string[] {
  const errors: string[] = [];
  const { coach_client_id, title, description } = input ?? {};

  if (!coach_client_id || !isValidUuid(coach_client_id)) {
    errors.push(t("invalid_coach_client_id"));
  }

  if (title !== undefined && (typeof title !== "string" || title.trim().length === 0)) {
    errors.push(t("plan_title_required"));
  }

  if (description !== undefined && (typeof description !== "string" || description.trim().length === 0)) {
    errors.push(t("plan_description_required"));
  }

  return errors;
}

export function validateUpdatePlan(
  input: UpdatePlanInput,
  t: Translate = tFallback
): string[] {
  const errors: string[] = [];
  const { title, description } = input ?? {};

  if (title === undefined && description === undefined) {
    errors.push(t("invalid_request"));
  }

  if (title !== undefined && (typeof title !== "string" || title.trim().length === 0)) {
    errors.push(t("template_title_required"));
  }

  return errors;
}

export interface CreatePlanExerciseInput {
  exercise_id: string;
  order_number?: number;
  sets?: number;
  reps?: number;
  rest_time?: number;
  notes?: string;
}

export interface UpdatePlanExerciseInput {
  order_number?: number;
  sets?: number;
  reps?: number;
  rest_time?: number;
  notes?: string;
}

export function validateCreatePlanExercise(
  input: CreatePlanExerciseInput,
  t: Translate = tFallback
): string[] {
  const errors: string[] = [];
  const { exercise_id, order_number, sets, reps, rest_time } = input ?? {};

  if (!exercise_id || !isValidUuid(exercise_id)) {
    errors.push(t("invalid_exercise_id"));
  }

  if (order_number !== undefined && (typeof order_number !== "number" || !Number.isInteger(order_number) || order_number < 1)) {
    errors.push(t("exercise_order_invalid"));
  }

  if (sets !== undefined && sets !== null && (typeof sets !== "number" || !Number.isInteger(sets) || sets < 1)) {
    errors.push(t("sets_invalid"));
  }

  if (reps !== undefined && reps !== null && (typeof reps !== "number" || !Number.isInteger(reps) || reps < 1)) {
    errors.push(t("reps_invalid"));
  }

  if (rest_time !== undefined && rest_time !== null && (typeof rest_time !== "number" || !Number.isInteger(rest_time) || rest_time < 1)) {
    errors.push(t("rest_time_invalid"));
  }

  return errors;
}

export function validateUpdatePlanExercise(
  input: UpdatePlanExerciseInput,
  t: Translate = tFallback
): string[] {
  const errors: string[] = [];
  const { order_number, sets, reps, rest_time, notes } = input ?? {};

  if (order_number === undefined && sets === undefined && reps === undefined && rest_time === undefined && notes === undefined) {
    errors.push(t("invalid_request"));
  }

  if (order_number !== undefined && (typeof order_number !== "number" || !Number.isInteger(order_number) || order_number < 1)) {
    errors.push(t("exercise_order_invalid"));
  }

  if (sets !== undefined && sets !== null && (typeof sets !== "number" || !Number.isInteger(sets) || sets < 1)) {
    errors.push(t("sets_invalid"));
  }

  if (reps !== undefined && reps !== null && (typeof reps !== "number" || !Number.isInteger(reps) || reps < 1)) {
    errors.push(t("reps_invalid"));
  }

  if (rest_time !== undefined && rest_time !== null && (typeof rest_time !== "number" || !Number.isInteger(rest_time) || rest_time < 1)) {
    errors.push(t("rest_time_invalid"));
  }

  return errors;
}

