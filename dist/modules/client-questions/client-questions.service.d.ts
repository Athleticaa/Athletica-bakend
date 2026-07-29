import type { AnswerItem } from "./client-questions.validation";
export declare class ServiceError extends Error {
    statusCode: number;
    messageKey: string;
    constructor(messageKey: string, statusCode: number);
}
export declare class ClientQuestionsService {
    private prisma;
    constructor();
    getQuestions(language: string): Promise<{
        id: string;
        created_at: Date;
        group_key: string;
        question: string;
        choices: string[];
        language: string;
    }[]>;
    getClientProfileId(userId: string): Promise<string>;
    getAnswers(clientId: string, language: string): Promise<{
        id: string;
        client_id: string;
        question_id: string;
        answer: number;
        answer_text: string | null;
        created_at: Date;
        question: string | null;
    }[]>;
    createAnswers(clientId: string, answers: AnswerItem[]): Promise<void>;
    updateAnswers(clientId: string, answers: AnswerItem[]): Promise<void>;
}
//# sourceMappingURL=client-questions.service.d.ts.map