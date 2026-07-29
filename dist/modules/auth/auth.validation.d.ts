export interface SignupInput {
    first_name: string;
    last_name: string;
    email: string;
    password: string;
    role: string;
    gender?: string;
    goal?: string;
    bio?: string;
    specialization?: string;
}
export interface LoginInput {
    email: string;
    password: string;
}
export interface ResetPasswordInput {
    email: string;
}
export interface ConfirmResetInput {
    email: string;
    code: string;
    password: string;
}
export interface ChangePasswordInput {
    old_password: string;
    new_password: string;
}
export interface VerifyEmailInput {
    email: string;
    code: string;
}
export interface ResendVerificationInput {
    email: string;
}
export declare function validateSignup(input: SignupInput, t?: (key: string) => string): string[];
export declare function validateLogin(input: LoginInput, t?: (key: string) => string): string[];
export declare function validateResetPassword(input: ResetPasswordInput, t?: (key: string) => string): string[];
export declare function validateConfirmReset(input: ConfirmResetInput, t?: (key: string) => string): string[];
export declare function validateChangePassword(input: ChangePasswordInput, t?: (key: string) => string): string[];
export declare function validateVerifyEmail(input: VerifyEmailInput, t?: (key: string) => string): string[];
export declare function validateResendVerification(input: ResendVerificationInput, t?: (key: string) => string): string[];
//# sourceMappingURL=auth.validation.d.ts.map