import "dotenv/config"
import { defineConfig } from "prisma/config"

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // `prisma generate` does not need a real DB connection — use a dummy URL
    // in CI / local environments where DATABASE_URL is not set so that the
    // postinstall hook (`npm ci` → `prisma generate`) does not fail with
    // PrismaConfigEnvError: Cannot resolve environment variable: DATABASE_URL.
    url: process.env.DATABASE_URL ?? "postgresql://user:password@localhost:5432/dummy",
  },
})
