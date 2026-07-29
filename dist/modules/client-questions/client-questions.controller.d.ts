import { Request, Response } from "express";
export declare class ClientQuestionsController {
    private service;
    constructor();
    private handleError;
    getQuestions: (req: Request, res: Response) => Promise<void>;
    getAnswers: (req: Request, res: Response) => Promise<void>;
    createAnswers: (req: Request, res: Response) => Promise<void>;
    updateAnswers: (req: Request, res: Response) => Promise<void>;
}
//# sourceMappingURL=client-questions.controller.d.ts.map