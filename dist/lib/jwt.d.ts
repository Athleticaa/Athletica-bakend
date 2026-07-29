export interface JwtPayload {
    sub: string;
    email: string;
    role: string;
}
export declare class JwtService {
    signToken(userId: string, email: string, role: string): string;
    verifyToken(token: string): JwtPayload;
}
//# sourceMappingURL=jwt.d.ts.map