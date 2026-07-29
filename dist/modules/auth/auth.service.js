"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = exports.ServiceError = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const crypto_1 = __importDefault(require("crypto"));
const tsyringe_1 = require("tsyringe");
const jwt_1 = require("../../lib/jwt");
const email_1 = require("../../services/email");
const tokens_1 = require("../../di/tokens");
const SALT_ROUNDS = 12;
class ServiceError extends Error {
    statusCode;
    messageKey;
    constructor(messageKey, statusCode) {
        super(messageKey);
        this.messageKey = messageKey;
        this.statusCode = statusCode;
    }
}
exports.ServiceError = ServiceError;
let AuthService = class AuthService {
    prisma;
    jwtService;
    emailService;
    constructor() {
        this.prisma = tsyringe_1.container.resolve(tokens_1.PrismaClientToken);
        this.jwtService = tsyringe_1.container.resolve(jwt_1.JwtService);
        this.emailService = tsyringe_1.container.resolve(email_1.EmailService);
    }
    hashPassword(password) {
        return bcryptjs_1.default.hash(password, SALT_ROUNDS);
    }
    comparePassword(password, hash) {
        return bcryptjs_1.default.compare(password, hash);
    }
    generateCode() {
        return crypto_1.default.randomInt(100000, 1000000).toString();
    }
    hashToken(token) {
        return crypto_1.default.createHash("sha256").update(token).digest("hex");
    }
    async signup(input, lng = "en") {
        const existing = await this.prisma.users.findUnique({ where: { email: input.email } });
        if (existing)
            throw new ServiceError("email_already_registered", 409);
        const hashedPassword = await this.hashPassword(input.password);
        const user = await this.prisma.users.create({
            data: {
                first_name: input.first_name,
                last_name: input.last_name,
                email: input.email,
                password: hashedPassword,
                role: input.role,
                provider: "email",
            },
        });
        if (input.role === "client") {
            await this.prisma.client_profiles.create({
                data: {
                    user_id: user.id,
                    gender: input.gender || "unspecified",
                    goal: input.goal || "not_set",
                },
            });
        }
        else if (input.role === "coach") {
            await this.prisma.coach_profiles.create({
                data: {
                    user_id: user.id,
                    bio: input.bio || "",
                    specialization: input.specialization || "general",
                },
            });
        }
        const code = this.generateCode();
        const codeHash = this.hashToken(code);
        await this.prisma.verification_codes.create({
            data: {
                user_id: user.id,
                code_hash: codeHash,
                expires_at: new Date(Date.now() + 10 * 60 * 1000),
            },
        });
        await this.emailService.sendVerificationCode(user.email, code, lng).catch(() => { });
    }
    generateRefreshToken() {
        return crypto_1.default.randomBytes(32).toString("hex");
    }
    async login(email, password) {
        const user = await this.prisma.users.findUnique({ where: { email } });
        if (!user)
            throw new ServiceError("invalid_email_or_password", 401);
        const valid = await this.comparePassword(password, user.password);
        if (!valid)
            throw new ServiceError("invalid_email_or_password", 401);
        if (!user.email_verified)
            throw new ServiceError("email_not_verified", 403);
        const token = this.jwtService.signToken(user.id, user.email, user.role);
        return {
            user: {
                id: user.id,
                first_name: user.first_name,
                last_name: user.last_name,
                email: user.email,
                role: user.role,
                email_verified: user.email_verified,
                created_at: user.created_at,
            },
            token,
        };
    }
    async verifyEmail(email, code) {
        const user = await this.prisma.users.findUnique({ where: { email } });
        if (!user)
            throw new ServiceError("invalid_request", 400);
        const codeHash = this.hashToken(code);
        const record = await this.prisma.verification_codes.findFirst({
            where: { user_id: user.id, code_hash: codeHash, used: false, expires_at: { gt: new Date() } },
        });
        if (!record)
            throw new ServiceError("invalid_or_expired_code", 400);
        const refreshTokenRaw = this.generateRefreshToken();
        const refreshTokenHash = this.hashToken(refreshTokenRaw);
        await this.prisma.$transaction(async (tx) => {
            await tx.users.update({ where: { id: user.id }, data: { email_verified: true } });
            await tx.verification_codes.update({ where: { id: record.id }, data: { used: true } });
            await tx.refresh_tokens.create({
                data: {
                    user_id: user.id,
                    token_hash: refreshTokenHash,
                    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                },
            });
        });
        const accessToken = this.jwtService.signToken(user.id, user.email, user.role);
        return {
            user: {
                id: user.id,
                first_name: user.first_name,
                last_name: user.last_name,
                email: user.email,
                role: user.role,
                email_verified: true,
                created_at: user.created_at,
            },
            token: accessToken,
            refreshToken: refreshTokenRaw,
        };
    }
    async resendVerificationCode(email, lng = "en") {
        const user = await this.prisma.users.findUnique({ where: { email } });
        if (!user)
            return;
        const code = this.generateCode();
        const codeHash = this.hashToken(code);
        await this.prisma.verification_codes.create({
            data: { user_id: user.id, code_hash: codeHash, expires_at: new Date(Date.now() + 10 * 60 * 1000) },
        });
        await this.emailService.sendVerificationCode(user.email, code, lng).catch(() => { });
    }
    async requestPasswordReset(email, lng = "en") {
        const user = await this.prisma.users.findUnique({ where: { email } });
        if (!user)
            return;
        const code = this.generateCode();
        const codeHash = this.hashToken(code);
        await this.prisma.password_reset_tokens.create({
            data: { user_id: user.id, token_hash: codeHash, expires_at: new Date(Date.now() + 60 * 60 * 1000) },
        });
        await this.emailService.sendPasswordResetCode(user.email, code, lng).catch(() => { });
    }
    async confirmPasswordReset(email, code, newPassword) {
        const user = await this.prisma.users.findUnique({ where: { email } });
        if (!user)
            throw new ServiceError("invalid_or_expired_token", 400);
        const codeHash = this.hashToken(code);
        const record = await this.prisma.password_reset_tokens.findFirst({
            where: { user_id: user.id, token_hash: codeHash, used: false, expires_at: { gt: new Date() } },
        });
        if (!record)
            throw new ServiceError("invalid_or_expired_token", 400);
        const hashedPassword = await this.hashPassword(newPassword);
        await this.prisma.$transaction([
            this.prisma.users.update({ where: { id: record.user_id }, data: { password: hashedPassword } }),
            this.prisma.password_reset_tokens.update({ where: { id: record.id }, data: { used: true } }),
        ]);
    }
    async changePassword(userId, oldPassword, newPassword) {
        const user = await this.prisma.users.findUnique({ where: { id: userId } });
        if (!user)
            throw new ServiceError("invalid_request", 400);
        const valid = await this.comparePassword(oldPassword, user.password);
        if (!valid)
            throw new ServiceError("old_password_incorrect", 400);
        const hashedPassword = await this.hashPassword(newPassword);
        await this.prisma.$transaction([
            this.prisma.users.update({ where: { id: userId }, data: { password: hashedPassword } }),
            this.prisma.refresh_tokens.deleteMany({ where: { user_id: userId } }),
        ]);
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = __decorate([
    (0, tsyringe_1.injectable)(),
    __metadata("design:paramtypes", [])
], AuthService);
//# sourceMappingURL=auth.service.js.map