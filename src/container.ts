import "reflect-metadata";
import { container } from "tsyringe";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClientToken } from "./di/tokens";
import { JwtService } from "./lib/jwt";
import { EmailService } from "./services/email";
import { AuthService } from "./modules/auth/auth.service";
import { AuthController } from "./modules/auth/auth.controller";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

container.registerInstance(PrismaClientToken, prisma);
container.registerSingleton(JwtService);
container.registerSingleton(EmailService);
container.registerSingleton(AuthService);
container.registerSingleton(AuthController);

export { container };
