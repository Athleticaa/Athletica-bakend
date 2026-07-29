import { Request, Response, NextFunction } from "express";
declare global {
    namespace Express {
        interface Request {
            t: (key: string) => string;
            language: string;
        }
    }
}
export declare function i18nMiddleware(req: Request, _res: Response, next: NextFunction): void;
//# sourceMappingURL=i18n.d.ts.map