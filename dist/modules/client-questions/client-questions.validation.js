"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateUpdateAnswers = void 0;
exports.validateSubmitAnswers = validateSubmitAnswers;
function tFallback(key) {
    return key;
}
function validateSubmitAnswers(input, t = tFallback) {
    const errors = [];
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
exports.validateUpdateAnswers = validateSubmitAnswers;
//# sourceMappingURL=client-questions.validation.js.map