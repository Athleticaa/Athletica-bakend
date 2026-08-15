import "dotenv/config";
import "reflect-metadata";
import "./container";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import "./lib/i18n";
import { i18nMiddleware } from "./middleware/i18n";
import authRoutes from "./modules/auth/auth.routes";
import clientQuestionsRoutes from "./modules/client-questions/client-questions.routes";
import { coachRouter, clientCoachRouter, requestsRouter } from "./modules/coach-assignment/coach-assignment.routes";
import workoutRoutes from "./modules/workout/workout.routes";
import nutritionRoutes from "./modules/nutrition/nutrition.routes";

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

app.get("/api/v1/health", (_req, res) => {
  res.json({ status: "ok" });
});

export default app;
