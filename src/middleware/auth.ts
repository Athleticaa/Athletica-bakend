import { Request, Response, NextFunction } from "express";
import { container } from "tsyringe";
import jwt from "jsonwebtoken";
import { JwtService, JwtPayload } from "../lib/jwt";

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: req.t("auth_required") });
    return;
  }

  const token = authHeader.split(" ")[1];
  try {
    const jwtService = container.resolve(JwtService);
    const decoded = jwtService.verifyToken(token);
    req.user = decoded;
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: req.t("token_expired") });
      return;
    }
    res.status(401).json({ error: req.t("token_invalid") });
  }
}

export function authorize(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: req.t("auth_required") });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: req.t("insufficient_permissions") });
      return;
    }

    next();
  };
}
