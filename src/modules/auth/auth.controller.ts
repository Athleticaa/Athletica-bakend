import { Request, Response } from "express";
import { injectable, inject } from "tsyringe";
import { AuthService, ServiceError } from "./auth.service";
import * as validation from "./auth.validation";

@injectable()
export class AuthController {
  constructor(@inject(AuthService) private authService: AuthService) {}

  private handleError(res: Response, err: unknown) {
    if (err instanceof ServiceError) {
      const t = (res.req as Request).t || ((s: string) => s);
      res.status(err.statusCode).json({ error: t(err.messageKey) });
      return;
    }
    console.error("unexpected error:", err);
    const t = (res.req as Request).t || ((s: string) => s);
    res.status(500).json({ error: t("internal_server_error") });
  }

  signup = async (req: Request, res: Response) => {
    const errors = validation.validateSignup(req.body, req.t);
    if (errors.length > 0) {
      res.status(400).json({ error: req.t("validation_failed"), details: errors });
      return;
    }

    try {
      await this.authService.signup(req.body, req.language);
      res.status(200).json({ message: req.t("code_sent") });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  login = async (req: Request, res: Response) => {
    const errors = validation.validateLogin(req.body, req.t);
    if (errors.length > 0) {
      res.status(400).json({ error: req.t("validation_failed"), details: errors });
      return;
    }

    try {
      const result = await this.authService.login(req.body.email, req.body.password);
      res.status(200).json(result);
    } catch (err) {
      this.handleError(res, err);
    }
  };

  resetPassword = async (req: Request, res: Response) => {
    const errors = validation.validateResetPassword(req.body, req.t);
    if (errors.length > 0) {
      res.status(400).json({ error: req.t("validation_failed"), details: errors });
      return;
    }

    try {
      await this.authService.requestPasswordReset(req.body.email, req.language);
      res.status(200).json({ message: req.t("reset_link_sent") });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  confirmReset = async (req: Request, res: Response) => {
    const errors = validation.validateConfirmReset(req.body, req.t);
    if (errors.length > 0) {
      res.status(400).json({ error: req.t("validation_failed"), details: errors });
      return;
    }

    try {
      await this.authService.confirmPasswordReset(req.body.email, req.body.code, req.body.password);
      res.status(200).json({ message: req.t("password_updated") });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  changePassword = async (req: Request, res: Response) => {
    const errors = validation.validateChangePassword(req.body, req.t);
    if (errors.length > 0) {
      res.status(400).json({ error: req.t("validation_failed"), details: errors });
      return;
    }

    try {
      await this.authService.changePassword(req.user!.sub, req.body.old_password, req.body.new_password);
      res.status(200).json({ message: req.t("password_updated") });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  verifyEmail = async (req: Request, res: Response) => {
    const errors = validation.validateVerifyEmail(req.body, req.t);
    if (errors.length > 0) {
      res.status(400).json({ error: req.t("validation_failed"), details: errors });
      return;
    }

    try {
      const result = await this.authService.verifyEmail(req.body.email, req.body.code);
      res.status(200).json(result);
    } catch (err) {
      this.handleError(res, err);
    }
  };

  resendVerification = async (req: Request, res: Response) => {
    const errors = validation.validateResendVerification(req.body, req.t);
    if (errors.length > 0) {
      res.status(400).json({ error: req.t("validation_failed"), details: errors });
      return;
    }

    try {
      await this.authService.resendVerificationCode(req.body.email, req.language);
      res.status(200).json({ message: req.t("code_sent") });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  me = (req: Request, res: Response) => {
    res.status(200).json({ user: req.user });
  };
}
