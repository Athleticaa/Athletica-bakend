const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

type Translate = (key: string) => string;

function tFallback(key: string): string {
  return key;
}

export const VALID_QUESTION_TYPES = [
  "NUMBER",
  "TEXT",
  "SINGLE_CHOICE",
  "YES_NO",
  "RATING",
  "IMAGE",
] as const;

export type CheckInQuestionType = (typeof VALID_QUESTION_TYPES)[number];

export interface CreateQuestionInput {
  question: string;
  type: CheckInQuestionType;
  options?: string[];
  required?: boolean;
  order?: number;
}

export interface UpdateQuestionInput {
  question?: string;
  type?: CheckInQuestionType;
  options?: string[];
  required?: boolean;
  order?: number;
}

export interface SubmitAnswerItem {
  question_id: string;
  answer_value: string;
}

// ── Coach validation ─────────────────────────────────────────────────────────

export function validateCreateQuestion(
  body: any,
  t: Translate = tFallback
): string[] {
  const errors: string[] = [];

  if (!body.question || typeof body.question !== "string" || !body.question.trim()) {
    errors.push(t("checkin_question_required"));
  } else if (body.question.trim().length > 500) {
    errors.push(t("checkin_question_too_long"));
  }

  if (!body.type || !(VALID_QUESTION_TYPES as readonly string[]).includes(body.type)) {
    errors.push(t("checkin_question_type_invalid"));
  }

  // SINGLE_CHOICE and YES_NO require at least 2 options
  if (body.type === "SINGLE_CHOICE" || body.type === "YES_NO") {
    if (!Array.isArray(body.options) || body.options.length < 2) {
      errors.push(t("checkin_options_required"));
    } else if (body.options.some((o: unknown) => typeof o !== "string" || !o.trim())) {
      errors.push(t("checkin_options_invalid"));
    }
  }

  if (body.order !== undefined) {
    if (typeof body.order !== "number" || !Number.isInteger(body.order) || body.order < 1) {
      errors.push(t("checkin_order_invalid"));
    }
  }

  return errors;
}

export function validateUpdateQuestion(
  body: any,
  t: Translate = tFallback
): string[] {
  const errors: string[] = [];

  const hasAnyField =
    body.question !== undefined ||
    body.type !== undefined ||
    body.options !== undefined ||
    body.required !== undefined ||
    body.order !== undefined;

  if (!hasAnyField) {
    errors.push(t("invalid_request"));
    return errors;
  }

  if (body.question !== undefined) {
    if (typeof body.question !== "string" || !body.question.trim()) {
      errors.push(t("checkin_question_required"));
    } else if (body.question.trim().length > 500) {
      errors.push(t("checkin_question_too_long"));
    }
  }

  if (body.type !== undefined && !(VALID_QUESTION_TYPES as readonly string[]).includes(body.type)) {
    errors.push(t("checkin_question_type_invalid"));
  }

  // SINGLE_CHOICE / YES_NO require >= 2 options. On update, changing type to a
  // choice type without supplying options would create an unanswerable question.
  if (body.type === "SINGLE_CHOICE" || body.type === "YES_NO") {
    if (!Array.isArray(body.options) || body.options.length < 2) {
      errors.push(t("checkin_options_required"));
    } else if (body.options.some((o: unknown) => typeof o !== "string" || !o.trim())) {
      errors.push(t("checkin_options_invalid"));
    }
  } else if (body.options !== undefined) {
    if (!Array.isArray(body.options) || body.options.some((o: unknown) => typeof o !== "string" || !o.trim())) {
      errors.push(t("checkin_options_invalid"));
    }
  }

  if (body.order !== undefined) {
    if (typeof body.order !== "number" || !Number.isInteger(body.order) || body.order < 1) {
      errors.push(t("checkin_order_invalid"));
    }
  }

  return errors;
}

export function validateReorderQuestions(
  body: any,
  t: Translate = tFallback
): string[] {
  const errors: string[] = [];

  if (!Array.isArray(body.question_ids) || body.question_ids.length === 0) {
    errors.push(t("checkin_question_ids_required"));
    return errors;
  }

  const seen = new Set<string>();
  for (const id of body.question_ids) {
    if (typeof id !== "string" || !isValidUuid(id)) {
      errors.push(t("invalid_uuid"));
    } else if (seen.has(id)) {
      errors.push(t("checkin_duplicate_question_id"));
    } else {
      seen.add(id);
    }
  }

  return errors;
}

export interface AssignCheckInInput {
  coach_client_id: string;
}

export function validateAssignCheckIn(
  body: any,
  t: Translate = tFallback
): string[] {
  const errors: string[] = [];
  if (!body.coach_client_id || typeof body.coach_client_id !== "string" || !isValidUuid(body.coach_client_id)) {
    errors.push(t("coach_client_id_required"));
  }
  return errors;
}

// ── Client validation ────────────────────────────────────────────────────────

export function validateSubmitCheckIn(
  body: any,
  t: Translate = tFallback
): string[] {
  const errors: string[] = [];

  if (!Array.isArray(body.answers) || body.answers.length === 0) {
    errors.push(t("checkin_answers_required"));
    return errors;
  }

  for (let i = 0; i < body.answers.length; i++) {
    const a = body.answers[i];
    if (!a || typeof a !== "object") {
      errors.push(`${t("invalid_request")} at answers[${i}]`);
      continue;
    }
    if (!a.question_id || typeof a.question_id !== "string" || !isValidUuid(a.question_id)) {
      errors.push(`${t("invalid_uuid")} at answers[${i}].question_id`);
    }
    if (a.answer_value === undefined || a.answer_value === null) {
      errors.push(`${t("checkin_answer_required")} at answers[${i}]`);
    }
  }

  return errors;
}
