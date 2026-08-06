import jwt from "jsonwebtoken";
import { injectable } from "tsyringe";

const JWT_SECRET = process.env.JWT_SECRET || "change-me-to-a-random-secret-in-production";
const JWT_EXPIRES_IN = "24h";
const INVITE_EXPIRES_IN = "7d";

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
}

export interface InviteTokenPayload {
  coach_profile_id: string;
  type: "invite";
  iat: number;
  exp: number;
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

  signInviteToken(coachProfileId: string): string {
    return jwt.sign({ coach_profile_id: coachProfileId, type: "invite" }, JWT_SECRET, {
      expiresIn: INVITE_EXPIRES_IN,
    });
  }

  verifyInviteToken(token: string): InviteTokenPayload {
    const decoded = jwt.verify(token, JWT_SECRET) as InviteTokenPayload;
    if (decoded.type !== "invite" || !decoded.coach_profile_id) {
      throw new jwt.JsonWebTokenError("invalid invite token");
    }
    return decoded;
  }
}
