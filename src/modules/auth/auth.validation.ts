import { isValidSpecialization } from "../profile/specializations";

const VALID_ROLES = ["coach", "client"] as const;

export interface SignupInput {
  username: string;
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

function tFallback(key: string): string {
  return key;
}

export function validateSignup(input: SignupInput, t: (key: string) => string = tFallback): string[] {
  const errors: string[] = [];
  if (!input.username || input.username.length < 1 || input.username.length > 100)
    errors.push(t("username_length"));
  if (!input.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email))
    errors.push(t("email_invalid"));
  if (!input.password || input.password.length < 8)
    errors.push(t("password_min"));
  if (!VALID_ROLES.includes(input.role as any))
    errors.push(t("role_invalid"));
  if (input.role === "coach" && input.specialization !== undefined) {
    if (!isValidSpecialization(input.specialization)) {
      errors.push(t("specialization_invalid"));
    }
  }
  return errors;
}

export function validateLogin(input: LoginInput, t: (key: string) => string = tFallback): string[] {
  const errors: string[] = [];
  if (!input.email) errors.push(t("email_required"));
  if (!input.password) errors.push(t("password_required"));
  return errors;
}

export function validateResetPassword(input: ResetPasswordInput, t: (key: string) => string = tFallback): string[] {
  const email = typeof input?.email === "string" ? input.email.trim() : "";
  if (!email) return [t("email_required")];
  return [];
}

export function validateConfirmReset(input: ConfirmResetInput, t: (key: string) => string = tFallback): string[] {
  const errors: string[] = [];
  // Only three fields: email, code, password. Extra fields are ignored.
  const email = typeof input?.email === "string" ? input.email.trim() : "";
  const rawCode = (input as { code?: unknown })?.code;
  const code =
    typeof rawCode === "number" && Number.isInteger(rawCode)
      ? String(rawCode)
      : typeof rawCode === "string"
        ? rawCode.trim()
        : "";
  const password = (input as { password?: unknown })?.password;

  if (!email) errors.push(t("email_required"));
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push(t("email_invalid"));

  if (!code) errors.push(t("code_required"));
  else if (!/^\d{6}$/.test(code)) errors.push(t("validation_code_invalid"));

  if (typeof password !== "string" || password.length === 0) errors.push(t("password_required"));
  else if (password.length < 8) errors.push(t("password_min"));

  return errors;
}

export function validateChangePassword(input: ChangePasswordInput, t: (key: string) => string = tFallback): string[] {
  const errors: string[] = [];
  if (!input.old_password) errors.push(t("old_password_required"));
  if (!input.new_password) errors.push(t("password_required"));
  else if (input.new_password.length < 8) errors.push(t("password_min"));
  return errors;
}

export function validateVerifyEmail(input: VerifyEmailInput, t: (key: string) => string = tFallback): string[] {
  const errors: string[] = [];
  const email = typeof input?.email === "string" ? input.email.trim() : "";
  const rawCode = (input as { code?: unknown })?.code;
  const code = typeof rawCode === "number" && Number.isInteger(rawCode) ? String(rawCode) : typeof rawCode === "string" ? rawCode.trim() : "";
  if (!email) errors.push(t("email_required"));
  if (!code) errors.push(t("code_required"));
  return errors;
}

export function validateResendVerification(input: ResendVerificationInput, t: (key: string) => string = tFallback): string[] {
  if (!input.email) return [t("email_required")];
  return [];
}
