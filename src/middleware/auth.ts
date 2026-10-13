import { Request, Response, NextFunction } from "express";
import { container } from "tsyringe";
import jwt from "jsonwebtoken";
import { JwtService, JwtPayload } from "../lib/jwt";
import { PrismaClientToken } from "../di/tokens";
import { PrismaClient } from "@prisma/client";

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: req.t("auth_required") });
    return;
  }

  const token = authHeader.split(" ")[1];
  let decoded: JwtPayload;
  try {
    const jwtService = container.resolve(JwtService);
    decoded = jwtService.verifyToken(token);
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: req.t("token_expired") });
      return;
    }
    res.status(401).json({ error: req.t("token_invalid") });
    return;
  }

  try {
    const prisma = container.resolve<PrismaClient>(PrismaClientToken);
    const user = await prisma.users.findUnique({ where: { id: decoded.sub }, select: { deleted_at: true } });
    if (!user || user.deleted_at) {
      res.status(401).json({ error: req.t("token_invalid") });
      return;
    }
    req.user = decoded;
    next();
  } catch {
    res.status(500).json({ error: req.t("internal_server_error") });
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
