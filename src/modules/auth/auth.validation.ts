const VALID_ROLES = ["coach", "client"] as const;

export interface SignupInput {
  first_name: string;
  last_name: string;
  email: string;
  password: string;
  role: string;
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
  if (!input.first_name || input.first_name.length < 1 || input.first_name.length > 100)
    errors.push(t("first_name_length"));
  if (!input.last_name || input.last_name.length < 1 || input.last_name.length > 100)
    errors.push(t("last_name_length"));
  if (!input.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email))
    errors.push(t("email_invalid"));
  if (!input.password || input.password.length < 8)
    errors.push(t("password_min"));
  if (!VALID_ROLES.includes(input.role as any))
    errors.push(t("role_invalid"));
  return errors;
}

export function validateLogin(input: LoginInput, t: (key: string) => string = tFallback): string[] {
  const errors: string[] = [];
  if (!input.email) errors.push(t("email_required"));
  if (!input.password) errors.push(t("password_required"));
  return errors;
}

export function validateResetPassword(input: ResetPasswordInput, t: (key: string) => string = tFallback): string[] {
  if (!input.email) return [t("email_required")];
  return [];
}

export function validateConfirmReset(input: ConfirmResetInput, t: (key: string) => string = tFallback): string[] {
  const errors: string[] = [];
  if (!input.email) errors.push(t("email_required"));
  if (!input.code) errors.push(t("code_required"));
  if (!input.password) errors.push(t("password_required"));
  else if (input.password.length < 8) errors.push(t("password_min"));
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
  if (!input.email) errors.push(t("email_required"));
  if (!input.code) errors.push(t("code_required"));
  return errors;
}

export function validateResendVerification(input: ResendVerificationInput, t: (key: string) => string = tFallback): string[] {
  if (!input.email) return [t("email_required")];
  return [];
}
