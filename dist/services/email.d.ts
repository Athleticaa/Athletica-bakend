export declare class EmailService {
    private resend;
    constructor();
    private t;
    sendVerificationCode(email: string, code: string, lng?: string): Promise<void>;
    sendPasswordResetCode(email: string, code: string, lng?: string): Promise<void>;
    private sendEmail;
}
//# sourceMappingURL=email.d.ts.map