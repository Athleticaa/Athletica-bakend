import bcrypt from "bcryptjs";
import crypto from "crypto";
import { PrismaClient } from "@prisma/client";
import { injectable, container } from "tsyringe";
import { JwtService } from "../../lib/jwt";
import { GoogleTokenInvalidError, sanitizeGoogleUsername, verifyGoogleIdToken } from "../../lib/google-auth";
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
    // Same for Google-only rows (password null): keep 409 so signup never
    // creates a duplicate or reveals password state beyond "already registered".
    // Google users must continue with POST /auth/google. Only coach/client allowed.
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

    // Google-only accounts have no password — same 401 as a wrong password
    // so the endpoint never reveals which credential type an email uses.
    if (!user.password) throw new ServiceError("invalid_email_or_password", 401);

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

  private issueSession(user: { id: string; username: string; email: string; role: string; email_verified: boolean; created_at: Date }) {
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

  /**
   * Google sign-in: verifies the ID token, then either signs in a returning
   * Google user (by google_sub), auto-links an existing email account, or
   * creates a new Google user with the Flutter-supplied role.
   * Role is immutable: the `role` param is ignored for existing users.
   */
  async loginWithGoogle(idToken: string, role?: string) {
    let account;
    try {
      account = await verifyGoogleIdToken(idToken);
    } catch (err) {
      if (err instanceof GoogleTokenInvalidError) throw new ServiceError("token_invalid", 401);
      throw err;
    }
    const email = this.normalizeEmail(account.email);

    // 1. Returning Google user — role param ignored, original role kept (only coach/client).
    // Sync the stored email in case the user changed it at Google (sub is stable).
    // Google auth always implies email_verified:true — heal legacy rows.
    const bySub = await this.prisma.users.findUnique({ where: { google_sub: account.sub } });
    if (bySub) {
      if (bySub.email.toLowerCase() !== email) {
        try {
          const updated = await this.prisma.users.update({
            where: { id: bySub.id },
            data: { email, email_verified: true },
          });
          return this.issueSession(updated);
        } catch (err) {
          // The new address is owned by a different Athletica account — surface
          // a conflict instead of a 500 so the user can resolve it.
          if ((err as { code?: string })?.code === "P2002") {
            throw new ServiceError("email_already_registered", 409);
          }
          throw err;
        }
      }
      if (!bySub.email_verified) {
        const healed = await this.prisma.users.update({
          where: { id: bySub.id },
          data: { email_verified: true },
        });
        return this.issueSession(healed);
      }
      return this.issueSession(bySub);
    }

    // 2. Existing email account — auto-link Google identity, keep everything else.
    const byEmail = await this.prisma.users.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
    });
    if (byEmail) {
      try {
        const linked = await this.prisma.users.update({
          where: { id: byEmail.id },
          data: { google_sub: account.sub, email_verified: true },
        });
        return this.issueSession(linked);
      } catch (err) {
        // Lost a link-vs-create race: this sub is already claimed by another row.
        if ((err as { code?: string })?.code === "P2002") {
          const winner = await this.prisma.users.findUnique({ where: { google_sub: account.sub } });
          if (winner) return this.issueSession(winner);
        }
        throw err;
      }
    }

    // 3. New user — role from the Flutter picker is required.
    if (role !== "coach" && role !== "client") throw new ServiceError("role_invalid", 400);
    const username = sanitizeGoogleUsername(account.name, email);

    try {
      let created!: { id: string; username: string; email: string; role: string; email_verified: boolean; created_at: Date };
      await this.prisma.$transaction(async (tx) => {
        const user = await tx.users.create({
          data: {
            username,
            email,
            password: null,
            role,
            provider: "google",
            google_sub: account.sub,
            email_verified: true,
          },
        });
        created = user;

        if (role === "client") {
          await tx.client_profiles.create({
            data: { user_id: user.id, gender: "unspecified", goal: "not_set" },
          });
        } else {
          const coachProfile = await tx.coach_profiles.create({
            data: { user_id: user.id, bio: "", specialization: "general" },
          });
          await createDefaultCheckInQuestions(tx, coachProfile.id);
        }
      });
      return this.issueSession(created);
    } catch (err) {
      // Lost a concurrent create race (unique email/google_sub) — sign in as the winner.
      if ((err as { code?: string })?.code === "P2002") {
        const winner =
          (await this.prisma.users.findUnique({ where: { google_sub: account.sub } })) ??
          (await this.prisma.users.findFirst({ where: { email: { equals: email, mode: "insensitive" } } }));
        if (winner) return this.issueSession(winner);
      }
      throw err;
    }
  }

  async verifyEmail(email: string, code: string) {
    const normalizedEmail = this.normalizeEmail(email);
    const normalizedCode = this.normalizeCode(code);
    const user = await this.prisma.users.findFirst({
      where: { email: { equals: normalizedEmail, mode: "insensitive" } },
    });
    if (!user) throw new ServiceError("invalid_request", 400);
    // Google users already have email_verified:true via loginWithGoogle and
    // skip this endpoint entirely — never mint tokens without a valid code.

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
    // Google sign-in already implies email_verified:true — skip resending
    // verification mail to already-verified users (Google or email).
    if (user.email_verified) return;

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
    // Intentional add-password path: Google-only accounts (password null)
    // are allowed here like email users. Requires inbox access, so no
    // escalation. After confirm, both Google and password login work;
    // provider stays "google" and google_sub is kept (Option A).

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
    // Intentional add-password path (Option A): Google-only accounts may set
    // a password here after proving inbox access. Keep google_sub, keep
    // provider="google", keep role immutable.

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

    // Google-only accounts have no password to change from.
    if (!user.password) throw new ServiceError("google_account_no_password", 400);

    const valid = await this.comparePassword(oldPassword, user.password);
    if (!valid) throw new ServiceError("old_password_incorrect", 400);

    const hashedPassword = await this.hashPassword(newPassword);
    await this.prisma.$transaction([
      this.prisma.users.update({ where: { id: userId }, data: { password: hashedPassword } }),
      this.prisma.refresh_tokens.deleteMany({ where: { user_id: userId } }),
    ]);
  }
}
