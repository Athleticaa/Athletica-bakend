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
export declare function validateSubmitAnswers(input: SubmitAnswersInput, t?: (key: string) => string): string[];
export declare const validateUpdateAnswers: typeof validateSubmitAnswers;
//# sourceMappingURL=client-questions.validation.d.ts.map