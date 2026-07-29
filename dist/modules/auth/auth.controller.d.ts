import { Request, Response } from "express";
export declare class AuthController {
    private authService;
    constructor();
    private handleError;
    signup: (req: Request, res: Response) => Promise<void>;
    login: (req: Request, res: Response) => Promise<void>;
    resetPassword: (req: Request, res: Response) => Promise<void>;
    confirmReset: (req: Request, res: Response) => Promise<void>;
    changePassword: (req: Request, res: Response) => Promise<void>;
    verifyEmail: (req: Request, res: Response) => Promise<void>;
    resendVerification: (req: Request, res: Response) => Promise<void>;
    me: (req: Request, res: Response) => void;
}
//# sourceMappingURL=auth.controller.d.ts.map