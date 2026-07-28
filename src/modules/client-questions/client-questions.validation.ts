export interface AnswerItem {
  question_id: string;
  answer: number;
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

export function validateSubmitAnswers(input: SubmitAnswersInput, t: (key: string) => string = tFallback): string[] {
  const errors: string[] = [];
  if (!input.answers || !Array.isArray(input.answers) || input.answers.length === 0) {
    errors.push(t("answers_required"));
    return errors;
  }
  for (let i = 0; i < input.answers.length; i++) {
    const item = input.answers[i];
    if (!item.question_id || typeof item.question_id !== "string") {
      errors.push(t("question_id_required") + ` at index ${i}`);
    }
    if (item.answer === undefined || item.answer === null || typeof item.answer !== "number" || !Number.isInteger(item.answer) || item.answer < 0) {
      errors.push(t("answer_invalid") + ` at index ${i}`);
    }
  }
  return errors;
}

export const validateUpdateAnswers = validateSubmitAnswers;
