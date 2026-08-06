import "reflect-metadata";
import { container } from "tsyringe";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClientToken } from "./di/tokens";
import { JwtService } from "./lib/jwt";
import { EmailService } from "./services/email";
import { AuthService } from "./modules/auth/auth.service";
import { AuthController } from "./modules/auth/auth.controller";
import { ClientQuestionsService } from "./modules/client-questions/client-questions.service";
import { ClientQuestionsController } from "./modules/client-questions/client-questions.controller";
import { CoachAssignmentService } from "./modules/coach-assignment/coach-assignment.service";
import { CoachAssignmentController } from "./modules/coach-assignment/coach-assignment.controller";
import { WorkoutService } from "./modules/workout/workout.service";
import { WorkoutController } from "./modules/workout/workout.controller";
import { NutritionService } from "./modules/nutrition/nutrition.service";
import { NutritionController } from "./modules/nutrition/nutrition.controller";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

container.registerInstance(PrismaClientToken, prisma);
container.registerSingleton(JwtService);
container.registerSingleton(EmailService);
container.registerSingleton(AuthService);
container.registerSingleton(AuthController);
container.registerSingleton(ClientQuestionsService);
container.registerSingleton(ClientQuestionsController);
container.registerSingleton(CoachAssignmentService);
container.registerSingleton(CoachAssignmentController);
container.registerSingleton(WorkoutService);
container.registerSingleton(WorkoutController);
container.registerSingleton(NutritionService);
container.registerSingleton(NutritionController);

export { container };
