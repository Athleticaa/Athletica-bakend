export type QuestionType = "choice" | "text";

export interface AnswerItem {
  question_id: string;
  answer: number | string;
}

export interface SubmitAnswersInput {
  answers: AnswerItem[];
}

export interface UpdateAnswersInput {
  answers: AnswerItem[];
}

function tFallback(key: string): string {
  return key;
}

function validateAnswerItem(item: AnswerItem, index: number, t: (key: string) => string): string[] {
  const errors: string[] = [];

  if (!item.question_id || typeof item.question_id !== "string") {
    errors.push(t("question_id_required") + ` at index ${index}`);
  }

  if (item.answer === undefined || item.answer === null) {
    errors.push(t("answer_required") + ` at index ${index}`);
    return errors;
  }

  const isNumber = typeof item.answer === "number";
  const isString = typeof item.answer === "string";

  if (!isNumber && !isString) {
    errors.push(t("answer_invalid") + ` at index ${index}`);
    return errors;
  }

  // For numeric (choice) answers: must be a non-negative integer
  if (isNumber && (!Number.isInteger(item.answer) || (item.answer as number) < 0)) {
    errors.push(t("answer_invalid") + ` at index ${index}`);
  }

  // For string (text) answers: must be non-empty
  if (isString && (item.answer as string).trim().length === 0) {
    errors.push(t("answer_text_empty") + ` at index ${index}`);
  }

  return errors;
}

export function validateSubmitAnswers(
  input: SubmitAnswersInput,
  t: (key: string) => string = tFallback
): string[] {
  const errors: string[] = [];

  if (!input.answers || !Array.isArray(input.answers) || input.answers.length === 0) {
    errors.push(t("answers_required"));
    return errors;
  }

  for (let i = 0; i < input.answers.length; i++) {
    errors.push(...validateAnswerItem(input.answers[i], i, t));
  }

  return errors;
}

export const validateUpdateAnswers = validateSubmitAnswers;
