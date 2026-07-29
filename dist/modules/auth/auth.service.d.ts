import type { SignupInput } from "./auth.validation";
export declare class ServiceError extends Error {
    statusCode: number;
    messageKey: string;
    constructor(messageKey: string, statusCode: number);
}
export declare class AuthService {
    private prisma;
    private jwtService;
    private emailService;
    constructor();
    private hashPassword;
    private comparePassword;
    private generateCode;
    private hashToken;
    signup(input: SignupInput, lng?: string): Promise<void>;
    private generateRefreshToken;
    login(email: string, password: string): Promise<{
        user: {
            id: string;
            first_name: string;
            last_name: string;
            email: string;
            role: string;
            email_verified: true;
            created_at: Date;
        };
        token: string;
    }>;
    verifyEmail(email: string, code: string): Promise<{
        user: {
            id: string;
            first_name: string;
            last_name: string;
            email: string;
            role: string;
            email_verified: boolean;
            created_at: Date;
        };
        token: string;
        refreshToken: string;
    }>;
    resendVerificationCode(email: string, lng?: string): Promise<void>;
    requestPasswordReset(email: string, lng?: string): Promise<void>;
    confirmPasswordReset(email: string, code: string, newPassword: string): Promise<void>;
    changePassword(userId: string, oldPassword: string, newPassword: string): Promise<void>;
}
//# sourceMappingURL=auth.service.d.ts.map