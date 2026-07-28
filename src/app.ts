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

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(i18nMiddleware);

app.use("/auth", authRoutes);
app.use("/client", clientQuestionsRoutes);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

export default app;
