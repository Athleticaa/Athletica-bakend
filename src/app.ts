import "dotenv/config";
import "reflect-metadata";
import "./container";
import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import multer from "multer";
import "./lib/i18n";
import { i18nMiddleware } from "./middleware/i18n";
import { ServiceError } from "./lib/service-error";
import authRoutes from "./modules/auth/auth.routes";
import clientQuestionsRoutes from "./modules/client-questions/client-questions.routes";
import { coachRouter, clientCoachRouter, requestsRouter } from "./modules/coach-assignment/coach-assignment.routes";
import workoutRoutes from "./modules/workout/workout.routes";
import nutritionRoutes from "./modules/nutrition/nutrition.routes";
import profileRoutes from "./modules/profile/profile.routes";
import { coachCheckInRouter, clientCheckInRouter } from "./modules/checkin/checkin.routes";
import messagingRoutes from "./modules/messaging/messaging.routes";
import realtimeRoutes from "./modules/realtime/realtime.routes";
import outboxRoutes from "./modules/internal/outbox.routes";
import { coachAchievementsRouter, clientAchievementsRouter } from "./modules/coach-achievements/coach-achievements.routes";

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(i18nMiddleware);

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1", requestsRouter);
app.use("/api/v1/coach", coachRouter);
app.use("/api/v1/client", clientQuestionsRoutes);
app.use("/api/v1/client", clientCoachRouter);
app.use("/api/v1/workout", workoutRoutes);
app.use("/api/v1/nutrition", nutritionRoutes);
app.use("/api/v1/profile", profileRoutes);
app.use("/api/v1/coach/checkin", coachCheckInRouter);
app.use("/api/v1/client/checkin", clientCheckInRouter);
app.use("/api/v1/messaging", messagingRoutes);
app.use("/api/v1/realtime", realtimeRoutes);
app.use("/api/v1/internal/outbox", outboxRoutes);
app.use("/api/v1/coach/achievements", coachAchievementsRouter);
app.use("/api/v1/client/coach/achievements", clientAchievementsRouter);

app.get("/api/v1/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Vercel deploy diagnostics: logs which required env vars are PRESENT at cold
// start (never their values). Only runs on Vercel to keep local/test logs clean.
if (process.env.VERCEL === "1") {
  console.log("[config] messaging env present:", {
    database_url: Boolean(process.env.DATABASE_URL),
    jwt_secret: Boolean(process.env.JWT_SECRET),
    ably_api_key: Boolean(process.env.ABLY_API_KEY),
    outbox_cron_secret: Boolean(process.env.OUTBOX_CRON_SECRET),
  });
}

app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ServiceError) {
    res.status(err.statusCode).json({ error: req.t(err.messageKey) });
    return;
  }
  if (err instanceof multer.MulterError) {
    const isAchievement = req.baseUrl.includes("/achievements") || req.path.includes("/achievements");
    const key =
      err.code === "LIMIT_FILE_SIZE"
        ? isAchievement
          ? "achievement_file_too_large"
          : "file_too_large"
        : "invalid_upload";
    res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: req.t(key) });
    return;
  }
  console.error("unexpected error:", err);
  res.status(500).json({ error: req.t("internal_server_error") });
});

export default app;
