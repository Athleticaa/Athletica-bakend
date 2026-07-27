import jwt from "jsonwebtoken";
import { injectable } from "tsyringe";

const JWT_SECRET = process.env.JWT_SECRET || "change-me-to-a-random-secret-in-production";
const JWT_EXPIRES_IN = "24h";

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
}

@injectable()
export class JwtService {
  signToken(userId: string, email: string, role: string): string {
    return jwt.sign({ sub: userId, email, role }, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN,
    });
  }

  verifyToken(token: string): JwtPayload {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  }
}
