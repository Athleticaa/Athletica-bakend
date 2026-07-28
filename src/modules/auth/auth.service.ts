import bcrypt from "bcryptjs";
import crypto from "crypto";
import { PrismaClient } from "@prisma/client";
import { injectable, container } from "tsyringe";
import { JwtService } from "../../lib/jwt";
import { EmailService } from "../../services/email";
import { PrismaClientToken } from "../../di/tokens";
import type { SignupInput } from "./auth.validation";

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

  async signup(input: SignupInput, lng = "en") {
    const existing = await this.prisma.users.findUnique({ where: { email: input.email } });
    if (existing) throw new ServiceError("email_already_registered", 409);

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
    } else if (input.role === "coach") {
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

    await this.emailService.sendVerificationCode(user.email, code, lng).catch(() => {});
  }

  private generateRefreshToken(): string {
    return crypto.randomBytes(32).toString("hex");
  }

  async login(email: string, password: string) {
    const user = await this.prisma.users.findUnique({ where: { email } });
    if (!user) throw new ServiceError("invalid_email_or_password", 401);

    const valid = await this.comparePassword(password, user.password);
    if (!valid) throw new ServiceError("invalid_email_or_password", 401);

    if (!user.email_verified) throw new ServiceError("email_not_verified", 403);

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

  async verifyEmail(email: string, code: string) {
    const user = await this.prisma.users.findUnique({ where: { email } });
    if (!user) throw new ServiceError("invalid_request", 400);

    const codeHash = this.hashToken(code);
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

  async resendVerificationCode(email: string, lng = "en") {
    const user = await this.prisma.users.findUnique({ where: { email } });
    if (!user) return;

    const code = this.generateCode();
    const codeHash = this.hashToken(code);
    await this.prisma.verification_codes.create({
      data: { user_id: user.id, code_hash: codeHash, expires_at: new Date(Date.now() + 10 * 60 * 1000) },
    });

    await this.emailService.sendVerificationCode(user.email, code, lng).catch(() => {});
  }

  async requestPasswordReset(email: string, lng = "en"): Promise<void> {
    const user = await this.prisma.users.findUnique({ where: { email } });
    if (!user) return;

    const code = this.generateCode();
    const codeHash = this.hashToken(code);

    await this.prisma.password_reset_tokens.create({
      data: { user_id: user.id, token_hash: codeHash, expires_at: new Date(Date.now() + 60 * 60 * 1000) },
    });

    await this.emailService.sendPasswordResetCode(user.email, code, lng).catch(() => {});
  }

  async confirmPasswordReset(email: string, code: string, newPassword: string) {
    const user = await this.prisma.users.findUnique({ where: { email } });
    if (!user) throw new ServiceError("invalid_or_expired_token", 400);

    const codeHash = this.hashToken(code);
    const record = await this.prisma.password_reset_tokens.findFirst({
      where: { user_id: user.id, token_hash: codeHash, used: false, expires_at: { gt: new Date() } },
    });

    if (!record) throw new ServiceError("invalid_or_expired_token", 400);

    const hashedPassword = await this.hashPassword(newPassword);

    await this.prisma.$transaction([
      this.prisma.users.update({ where: { id: record.user_id }, data: { password: hashedPassword } }),
      this.prisma.password_reset_tokens.update({ where: { id: record.id }, data: { used: true } }),
    ]);
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
