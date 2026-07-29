"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateSignup = validateSignup;
exports.validateLogin = validateLogin;
exports.validateResetPassword = validateResetPassword;
exports.validateConfirmReset = validateConfirmReset;
exports.validateChangePassword = validateChangePassword;
exports.validateVerifyEmail = validateVerifyEmail;
exports.validateResendVerification = validateResendVerification;
const VALID_ROLES = ["coach", "client"];
function tFallback(key) {
    return key;
}
function validateSignup(input, t = tFallback) {
    const errors = [];
    if (!input.first_name || input.first_name.length < 1 || input.first_name.length > 100)
        errors.push(t("first_name_length"));
    if (!input.last_name || input.last_name.length < 1 || input.last_name.length > 100)
        errors.push(t("last_name_length"));
    if (!input.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email))
        errors.push(t("email_invalid"));
    if (!input.password || input.password.length < 8)
        errors.push(t("password_min"));
    if (!VALID_ROLES.includes(input.role))
        errors.push(t("role_invalid"));
    return errors;
}
function validateLogin(input, t = tFallback) {
    const errors = [];
    if (!input.email)
        errors.push(t("email_required"));
    if (!input.password)
        errors.push(t("password_required"));
    return errors;
}
function validateResetPassword(input, t = tFallback) {
    if (!input.email)
        return [t("email_required")];
    return [];
}
function validateConfirmReset(input, t = tFallback) {
    const errors = [];
    if (!input.email)
        errors.push(t("email_required"));
    if (!input.code)
        errors.push(t("code_required"));
    if (!input.password)
        errors.push(t("password_required"));
    else if (input.password.length < 8)
        errors.push(t("password_min"));
    return errors;
}
function validateChangePassword(input, t = tFallback) {
    const errors = [];
    if (!input.old_password)
        errors.push(t("old_password_required"));
    if (!input.new_password)
        errors.push(t("password_required"));
    else if (input.new_password.length < 8)
        errors.push(t("password_min"));
    return errors;
}
function validateVerifyEmail(input, t = tFallback) {
    const errors = [];
    if (!input.email)
        errors.push(t("email_required"));
    if (!input.code)
        errors.push(t("code_required"));
    return errors;
}
function validateResendVerification(input, t = tFallback) {
    if (!input.email)
        return [t("email_required")];
    return [];
}
//# sourceMappingURL=auth.validation.js.map