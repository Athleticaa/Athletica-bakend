import "reflect-metadata";
import { JwtPayload, JwtService } from "../../src/lib/jwt";
import { validateSignup, validateLogin, validateConfirmReset, validateVerifyEmail, validateChangePassword } from "../../src/modules/auth/auth.validation";

const jwtService = new JwtService();

describe("JwtService", () => {
  it("should sign and verify a JWT token", () => {
    const token = jwtService.signToken("user-id-123", "test@example.com", "coach");
    expect(token).toBeDefined();

    const payload = jwtService.verifyToken(token);
    expect(payload.sub).toBe("user-id-123");
    expect(payload.email).toBe("test@example.com");
    expect(payload.role).toBe("coach");
  });

  it("should throw on invalid token", () => {
    expect(() => jwtService.verifyToken("invalidtoken")).toThrow();
  });
});

describe("validateSignup", () => {
  it("should return no errors for valid input", () => {
    const errors = validateSignup({
      first_name: "John",
      last_name: "Doe",
      email: "john@example.com",
      password: "password123",
      role: "coach",
    });
    expect(errors.length).toBe(0);
  });

  it("should return errors for invalid role", () => {
    const errors = validateSignup({
      first_name: "John",
      last_name: "Doe",
      email: "john@example.com",
      password: "password123",
      role: "admin",
    });
    expect(errors).toContain("role_invalid");
  });

  it("should return errors for short password", () => {
    const errors = validateSignup({
      first_name: "John",
      last_name: "Doe",
      email: "john@example.com",
      password: "short",
      role: "coach",
    });
    expect(errors).toContain("password_min");
  });

  it("should return errors for invalid email", () => {
    const errors = validateSignup({
      first_name: "John",
      last_name: "Doe",
      email: "notanemail",
      password: "password123",
      role: "coach",
    });
    expect(errors).toContain("email_invalid");
  });
});

describe("validateLogin", () => {
  it("should return no errors for valid input", () => {
    const errors = validateLogin({ email: "test@example.com", password: "password123" });
    expect(errors.length).toBe(0);
  });

  it("should return errors when email is missing", () => {
    const errors = validateLogin({ email: "", password: "password123" });
    expect(errors).toContain("email_required");
  });

  it("should return errors when password is missing", () => {
    const errors = validateLogin({ email: "test@example.com", password: "" });
    expect(errors).toContain("password_required");
  });
});

describe("validateConfirmReset", () => {
  it("should return no errors for valid input", () => {
    const errors = validateConfirmReset({ email: "test@example.com", code: "123456", password: "newpassword123" });
    expect(errors.length).toBe(0);
  });

  it("should return error for short password", () => {
    const errors = validateConfirmReset({ email: "test@example.com", code: "123456", password: "short" });
    expect(errors).toContain("password_min");
  });

  it("should return error when email is missing", () => {
    const errors = validateConfirmReset({ email: "", code: "123456", password: "newpassword123" });
    expect(errors).toContain("email_required");
  });

  it("should return error when code is missing", () => {
    const errors = validateConfirmReset({ email: "test@example.com", code: "", password: "newpassword123" });
    expect(errors).toContain("code_required");
  });
});

describe("validateVerifyEmail", () => {
  it("should return no errors for valid input", () => {
    const errors = validateVerifyEmail({ email: "test@example.com", code: "123456" });
    expect(errors.length).toBe(0);
  });

  it("should return error when code is missing", () => {
    const errors = validateVerifyEmail({ email: "test@example.com", code: "" });
    expect(errors).toContain("code_required");
  });
});

describe("validateChangePassword", () => {
  it("should return no errors for valid input", () => {
    const errors = validateChangePassword({ old_password: "oldpass123", new_password: "newpass123" });
    expect(errors.length).toBe(0);
  });

  it("should return error when old_password is missing", () => {
    const errors = validateChangePassword({ old_password: "", new_password: "newpass123" });
    expect(errors).toContain("old_password_required");
  });

  it("should return error when new_password is missing", () => {
    const errors = validateChangePassword({ old_password: "oldpass123", new_password: "" });
    expect(errors).toContain("password_required");
  });

  it("should return error for short new_password", () => {
    const errors = validateChangePassword({ old_password: "oldpass123", new_password: "short" });
    expect(errors).toContain("password_min");
  });
});
