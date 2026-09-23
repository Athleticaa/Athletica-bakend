import bcrypt from "bcryptjs";
import crypto from "crypto";
import { PrismaClient } from "@prisma/client";
import { injectable, container } from "tsyringe";
import { JwtService } from "../../lib/jwt";
import { EmailService } from "../../services/email";
import { PrismaClientToken } from "../../di/tokens";
import type { SignupInput } from "./auth.validation";
import { createDefaultCheckInQuestions } from "../checkin/checkin-defaults";

const SALT_ROUNDS = 12;

export class ServiceError extends Error {
  statusCode: number;
  messageKey: string;
  constructor(messageKey: string, statusCode: number) {
    super(messageKey);
    this.messageKey = messageKey;
    this.statusCode = statusCode;
  }
}

@injectable()
export class AuthService {
  private prisma: PrismaClient;
  private jwtService: JwtService;
  private emailService: EmailService;

  constructor() {
    this.prisma = container.resolve(PrismaClientToken);
    this.jwtService = container.resolve(JwtService);
    this.emailService = container.resolve(EmailService);
  }

  private hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, SALT_ROUNDS);
  }

  private comparePassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  private generateCode(): string {
    return crypto.randomInt(100000, 1000000).toString();
  }

  private hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  private normalizeEmail(email: unknown): string {
    return typeof email === "string" ? email.trim().toLowerCase() : "";
  }

  private normalizeCode(code: unknown): string {
    if (typeof code === "number" && Number.isInteger(code)) return String(code);
    return typeof code === "string" ? code.trim() : "";
  }

  async signup(input: SignupInput, lng = "en") {
    const email = this.normalizeEmail(input.email);
    const existing = await this.prisma.users.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
    });
    if (existing) throw new ServiceError("email_already_registered", 409);

    const trimmedUsername = typeof input.username === "string" ? input.username.trim() : input.username;
    const hashedPassword = await this.hashPassword(input.password);

    const code = this.generateCode();
    const codeHash = this.hashToken(code);

    // All writes in one transaction: user + profile + defaults + verification code.
    // Prevents orphaned user if coach profile/defaults seeding fails.
    let createdUserEmail = email;
    await this.prisma.$transaction(async (tx) => {
      const user = await tx.users.create({
        data: {
          username: trimmedUsername,
          email,
          password: hashedPassword,
          role: input.role,
          provider: "email",
        },
      });
      createdUserEmail = user.email;

      if (input.role === "client") {
        await tx.client_profiles.create({
          data: {
            user_id: user.id,
            gender: input.gender || "unspecified",
            goal: input.goal || "not_set",
          },
        });
      } else if (input.role === "coach") {
        const coachProfile = await tx.coach_profiles.create({
          data: {
            user_id: user.id,
            bio: input.bio || "",
            specialization: input.specialization || "general",
          },
        });
        await createDefaultCheckInQuestions(tx, coachProfile.id);
      }

      await tx.verification_codes.create({
        data: {
          user_id: user.id,
          code_hash: codeHash,
          expires_at: new Date(Date.now() + 10 * 60 * 1000),
        },
      });
    });

    await this.emailService.sendVerificationCode(createdUserEmail, code, lng).catch(() => {});
  }

  private generateRefreshToken(): string {
    return crypto.randomBytes(32).toString("hex");
  }

  async login(email: string, password: string) {
    const normalizedEmail = this.normalizeEmail(email);
    const user = await this.prisma.users.findFirst({
      where: { email: { equals: normalizedEmail, mode: "insensitive" } },
    });
    if (!user) throw new ServiceError("invalid_email_or_password", 401);

    const valid = await this.comparePassword(password, user.password);
    if (!valid) throw new ServiceError("invalid_email_or_password", 401);

    if (!user.email_verified) throw new ServiceError("email_not_verified", 403);

    const token = this.jwtService.signToken(user.id, user.email, user.role);

    return {
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        email_verified: user.email_verified,
        created_at: user.created_at,
      },
      token,
    };
  }

  async verifyEmail(email: string, code: string) {
    const normalizedEmail = this.normalizeEmail(email);
    const normalizedCode = this.normalizeCode(code);
    const user = await this.prisma.users.findFirst({
      where: { email: { equals: normalizedEmail, mode: "insensitive" } },
    });
    if (!user) throw new ServiceError("invalid_request", 400);

    const codeHash = this.hashToken(normalizedCode);
    const record = await this.prisma.verification_codes.findFirst({
      where: { user_id: user.id, code_hash: codeHash, used: false, expires_at: { gt: new Date() } },
    });

    if (!record) throw new ServiceError("invalid_or_expired_code", 400);

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
        username: user.username,
        email: user.email,
        role: user.role,
        email_verified: true,
        created_at: user.created_at,
      },
      token: accessToken,
      refreshToken: refreshTokenRaw,
    };
  }

  async resendVerificationCode(email: string, lng = "en") {
    const normalizedEmail = this.normalizeEmail(email);
    const user = await this.prisma.users.findFirst({
      where: { email: { equals: normalizedEmail, mode: "insensitive" } },
    });
    if (!user) return;

    const code = this.generateCode();
    const codeHash = this.hashToken(code);
    await this.prisma.verification_codes.create({
      data: { user_id: user.id, code_hash: codeHash, expires_at: new Date(Date.now() + 10 * 60 * 1000) },
    });

    await this.emailService.sendVerificationCode(user.email, code, lng).catch(() => {});
  }

  async requestPasswordReset(email: string, lng = "en"): Promise<void> {
    const normalizedEmail = this.normalizeEmail(email);
    if (!normalizedEmail) return;
    const user = await this.prisma.users.findFirst({
      where: { email: { equals: normalizedEmail, mode: "insensitive" } },
    });
    if (!user) return;

    const code = this.generateCode();
    const codeHash = this.hashToken(code);

    // Invalidate older unused codes so only the latest email works.
    // Prevents "used old code from previous request" confusion.
    await this.prisma.$transaction([
      this.prisma.password_reset_tokens.updateMany({
        where: { user_id: user.id, used: false },
        data: { used: true },
      }),
      this.prisma.password_reset_tokens.create({
        data: { user_id: user.id, token_hash: codeHash, expires_at: new Date(Date.now() + 60 * 60 * 1000) },
      }),
    ]);

    await this.emailService.sendPasswordResetCode(user.email, code, lng).catch(() => {});
  }

  async confirmPasswordReset(email: string, code: string, newPassword: string) {
    const normalizedEmail = this.normalizeEmail(email);
    const normalizedCode = this.normalizeCode(code);
    if (!normalizedEmail || !normalizedCode) {
      throw new ServiceError("invalid_or_expired_reset_token", 400);
    }
    const user = await this.prisma.users.findFirst({
      where: { email: { equals: normalizedEmail, mode: "insensitive" } },
    });
    if (!user) throw new ServiceError("invalid_or_expired_reset_token", 400);

    const codeHash = this.hashToken(normalizedCode);
    const record = await this.prisma.password_reset_tokens.findFirst({
      where: { user_id: user.id, token_hash: codeHash, used: false, expires_at: { gt: new Date() } },
    });

    if (!record) throw new ServiceError("invalid_or_expired_reset_token", 400);

    const hashedPassword = await this.hashPassword(newPassword);

    await this.prisma.$transaction([
      this.prisma.users.update({ where: { id: record.user_id }, data: { password: hashedPassword } }),
      this.prisma.password_reset_tokens.update({ where: { id: record.id }, data: { used: true } }),
    ]);
  }

  async logout(userId: string) {
    await this.prisma.refresh_tokens.deleteMany({ where: { user_id: userId } });
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string) {
    const user = await this.prisma.users.findUnique({ where: { id: userId } });
    if (!user) throw new ServiceError("invalid_request", 400);

    const valid = await this.comparePassword(oldPassword, user.password);
    if (!valid) throw new ServiceError("old_password_incorrect", 400);

    const hashedPassword = await this.hashPassword(newPassword);
    await this.prisma.$transaction([
      this.prisma.users.update({ where: { id: userId }, data: { password: hashedPassword } }),
      this.prisma.refresh_tokens.deleteMany({ where: { user_id: userId } }),
    ]);
  }
}
