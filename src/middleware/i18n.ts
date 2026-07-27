import { Request, Response, NextFunction } from "express";
import i18next from "../lib/i18n";

const SUPPORTED = ["en", "ar"];

declare global {
  namespace Express {
    interface Request {
      t: (key: string) => string;
      language: string;
    }
  }
}

export function i18nMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers["accept-language"] || "en";
  const lang = SUPPORTED.find((l) => header.startsWith(l)) || "en";

  req.language = lang;
  req.t = (key: string) => i18next.t(key, { lng: lang });

  next();
}
