import * as fs from "fs";
import * as path from "path";

interface OpenAPISchema {
  openapi: string;
  info: {
    title: string;
    version: string;
    description: string;
  };
  servers: Array<{ url: string; description: string }>;
  paths: Record<string, Record<string, any>>;
  components: {
    securitySchemes: Record<string, any>;
    schemas: Record<string, any>;
  };
}

interface RouteInfo {
  method: string;
  path: string;
  middleware: string[];
  file: string;
  routerVar: string;
}

interface RouteFileConfig {
  file: string;
  /** Default mount prefix from src/app.ts (e.g. "/api/v1/workout") */
  mount: string;
  tag: string;
  /** Optional per-router-var mount overrides (for files exporting multiple routers) */
  routers?: Record<string, string>;
}

const ROUTES_DIR = path.join(__dirname, "../src/modules");
const BASE_URL = "http://localhost:3000";

function extractRoutes(filePath: string): RouteInfo[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const routes: RouteInfo[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(
      /(\w+)\.(get|post|put|delete|patch)\s*\(\s*["'`]([^"'`]+)["'`]\s*(?:,\s*(.+))?\)/i
    );
    if (match) {
      const routerVar = match[1];
      // Skip the `Router()` factory call itself (e.g. `Router()` has no method prefix match,
      // but guard against false positives like `express.Router` noise).
      if (routerVar.toLowerCase() === "express") continue;
      const method = match[2].toLowerCase();
      const routePath = match[3];
      const middlewareStr = match[4] || "";
      const middleware = middlewareStr
        .split(",")
        .map((m) => m.trim())
        .filter((m) => m && !m.includes("controller") && !m.includes("upload"));

      routes.push({
        method,
        path: routePath,
        middleware,
        file: filePath,
        routerVar,
      });
    }
  }

  return routes;
}

function convertExpressPathToOpenAPI(expressPath: string): string {
  return expressPath.replace(/:([a-zA-Z]+)/g, "{$1}");
}

function getAuthRequirements(middleware: string[]): any {
  if (middleware.includes("authenticate")) {
    return [{ bearerAuth: [] }];
  }
  return [];
}

function getRequestBodySpec(
  method: string,
  fullPath: string,
  routePath: string
): { contentType: string; schema: any } | undefined {
  if (method === "get" || method === "delete") {
    return undefined;
  }

  const JSON = "application/json";

  // ── Check-In (coach) ───────────────────────────────────────────
  if (fullPath === "/api/v1/coach/checkin/questions" && method === "post") {
    return {
      contentType: JSON,
      schema: {
        type: "object",
        properties: {
          question: { type: "string", maxLength: 500 },
          type: {
            type: "string",
            enum: ["NUMBER", "TEXT", "SINGLE_CHOICE", "YES_NO", "RATING", "IMAGE"],
          },
          options: { type: "array", items: { type: "string" } },
          required: { type: "boolean" },
          order: { type: "integer", minimum: 1 },
        },
        required: ["question", "type"],
      },
    };
  }

  if (fullPath === "/api/v1/coach/checkin/questions/reorder" && method === "patch") {
    return {
      contentType: JSON,
      schema: {
        type: "object",
        properties: {
          question_ids: {
            type: "array",
            items: { type: "string", format: "uuid" },
          },
        },
        required: ["question_ids"],
      },
    };
  }

  if (
    fullPath.startsWith("/api/v1/coach/checkin/questions/") &&
    method === "patch"
  ) {
    return {
      contentType: JSON,
      schema: {
        type: "object",
        properties: {
          question: { type: "string", maxLength: 500 },
          type: {
            type: "string",
            enum: ["NUMBER", "TEXT", "SINGLE_CHOICE", "YES_NO", "RATING", "IMAGE"],
          },
          options: { type: "array", items: { type: "string" } },
          required: { type: "boolean" },
          order: { type: "integer", minimum: 1 },
        },
      },
    };
  }

  // ── Check-In: assign ───────────────────────────────────────────────
  if (fullPath === "/api/v1/coach/checkin/assign" && method === "post") {
    return {
      contentType: JSON,
      schema: {
        type: "object",
        properties: {
          coach_client_id: { type: "string", format: "uuid", description: "coach_clients.id (must be assigned via coach_clients)" },
        },
        required: ["coach_client_id"],
      },
    };
  }

  // ── Check-In (client submit — multipart/form-data) ─────────────
  if (fullPath === "/api/v1/client/checkin/submit" && method === "post") {
    return {
      contentType: "multipart/form-data",
      schema: {
        type: "object",
        properties: {
          answers: {
            type: "string",
            description:
              'JSON string array of { question_id (uuid), answer_value (string) }. Example: [{"question_id":"uuid","answer_value":"76.4"}]',
          },
        },
        required: ["answers"],
        description:
          "Image answers: attach one file per IMAGE question with the field name = question_id (jpeg/png/webp, max 5MB each).",
      },
    };
  }

  // ── Auth ───────────────────────────────────────────────────────
  if (routePath.includes("/signup")) {
    return {
      contentType: JSON,
      schema: {
        type: "object",
        properties: {
          username: { type: "string", minLength: 1, maxLength: 100 },
          email: { type: "string", format: "email" },
          password: { type: "string", minLength: 8 },
          role: { type: "string", enum: ["coach", "client"] },
          gender: { type: "string" },
          goal: { type: "string" },
          bio: { type: "string" },
          specialization: { type: "string" },
        },
        required: ["username", "email", "password", "role"],
      },
    };
  } else if (routePath.includes("/login")) {
    return {
      contentType: JSON,
      schema: {
        type: "object",
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string" },
        },
        required: ["email", "password"],
      },
    };
  }

  // ── Workout / Nutrition templates ──────────────────────────────
  if (
    routePath.includes("/templates") &&
    !routePath.includes("/days") &&
    !routePath.includes("/exercises") &&
    !routePath.includes("/meals") &&
    !routePath.includes("/foods")
  ) {
    // POST /templates/:tid/assign has its own shape
    if (routePath.includes("/assign")) {
      return {
        contentType: JSON,
        schema: {
          type: "object",
          properties: {
            coach_client_id: { type: "string", format: "uuid" },
            title: { type: "string" },
            description: { type: "string" },
          },
          required: ["coach_client_id"],
        },
      };
    }
    return {
      contentType: JSON,
      schema: {
        type: "object",
        properties: {
          title: { type: "string", maxLength: 100 },
          description: { type: "string", maxLength: 500 },
        },
        required: ["title", "description"],
      },
    };
  } else if (routePath.includes("/assign")) {
    return {
      contentType: JSON,
      schema: {
        type: "object",
        properties: {
          coach_client_id: { type: "string", format: "uuid" },
          title: { type: "string" },
          description: { type: "string" },
        },
        required: ["coach_client_id"],
      },
    };
  } else if (
    routePath.includes("/exercises") &&
    !routePath.includes("/complete") &&
    !routePath.includes("/uncomplete")
  ) {
    return {
      contentType: JSON,
      schema: {
        type: "object",
        properties: {
          exercise_id: { type: "string", format: "uuid" },
          exercise_order: { type: "integer", minimum: 1 },
          notes: { type: "string" },
        },
        required: ["exercise_id"],
      },
    };
  } else if (routePath.includes("/meals") && !routePath.includes("/foods")) {
    return {
      contentType: JSON,
      schema: {
        type: "object",
        properties: {
          meal_type: { type: "string" },
          meal_order: { type: "integer", minimum: 1 },
          notes: { type: "string" },
        },
        required: ["meal_type"],
      },
    };
  } else if (
    routePath.includes("/foods") &&
    !routePath.includes("/complete") &&
    !routePath.includes("/uncomplete")
  ) {
    return {
      contentType: JSON,
      schema: {
        type: "object",
        properties: {
          food_id: { type: "string", format: "uuid" },
          quantity: { type: "number", minimum: 0 },
        },
        required: ["food_id", "quantity"],
      },
    };
  } else if (routePath.includes("/reorder")) {
    return {
      contentType: JSON,
      schema: {
        type: "object",
        properties: {
          day_ids: { type: "array", items: { type: "string", format: "uuid" } },
        },
        required: ["day_ids"],
      },
    };
  }

  return { contentType: JSON, schema: { type: "object" } };
}

function generateParameters(
  routePath: string,
  method: string,
  fullPath: string
): any[] {
  const params: any[] = [];

  const uuidParams = routePath.match(/:([a-zA-Z]+)/g);
  if (uuidParams) {
    for (const param of uuidParams) {
      const paramName = param.slice(1);
      params.push({
        name: paramName,
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
      });
    }
  }

  if (method === "get" && fullPath.includes("/workout/exercises")) {
    params.push(
      { name: "search", in: "query", schema: { type: "string" } },
      { name: "bodyPart", in: "query", schema: { type: "string" } },
      { name: "target", in: "query", schema: { type: "string" } },
      { name: "secondaryMuscle", in: "query", schema: { type: "string" } },
      { name: "equipment", in: "query", schema: { type: "string" } },
      { name: "difficulty", in: "query", schema: { type: "string" } },
      { name: "muscleGroup", in: "query", schema: { type: "string" } },
      { name: "compound", in: "query", schema: { type: "boolean" } },
      { name: "unilateral", in: "query", schema: { type: "boolean" } },
      { name: "page", in: "query", schema: { type: "integer", default: 1 } },
      { name: "pageSize", in: "query", schema: { type: "integer", default: 20 } }
    );
  }

  if (method === "get" && fullPath.includes("/nutrition/foods")) {
    params.push(
      { name: "search", in: "query", schema: { type: "string" } },
      { name: "categoryId", in: "query", schema: { type: "string", format: "uuid" } },
      { name: "isArchived", in: "query", schema: { type: "boolean" } },
      { name: "minCalories", in: "query", schema: { type: "number" } },
      { name: "maxCalories", in: "query", schema: { type: "number" } },
      { name: "minProtein", in: "query", schema: { type: "number" } },
      { name: "maxProtein", in: "query", schema: { type: "number" } },
      { name: "minCarbs", in: "query", schema: { type: "number" } },
      { name: "maxCarbs", in: "query", schema: { type: "number" } },
      { name: "minFat", in: "query", schema: { type: "number" } },
      { name: "maxFat", in: "query", schema: { type: "number" } },
      { name: "page", in: "query", schema: { type: "integer", default: 1 } },
      { name: "pageSize", in: "query", schema: { type: "integer", default: 20 } }
    );
  }

  if (method === "get" && routePath.includes("/history")) {
    params.push(
      { name: "from", in: "query", required: true, schema: { type: "string", format: "date" } },
      { name: "to", in: "query", required: true, schema: { type: "string", format: "date" } }
    );
  }

  return params;
}

function generateOpenAPISpec(): OpenAPISchema {
  const spec: OpenAPISchema = {
    openapi: "3.0.3",
    info: {
      title: "Athletica API",
      version: "1.0.0",
      description: "Fitness coaching platform API",
    },
    servers: [{ url: BASE_URL, description: "Development server" }],
    paths: {},
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
      schemas: {},
    },
  };

  // Mount prefixes mirror src/app.ts
  const routeFiles: RouteFileConfig[] = [
    { file: "auth/auth.routes.ts", mount: "/api/v1/auth", tag: "Auth" },
    { file: "workout/workout.routes.ts", mount: "/api/v1/workout", tag: "Workout" },
    { file: "nutrition/nutrition.routes.ts", mount: "/api/v1/nutrition", tag: "Nutrition" },
    { file: "profile/profile.routes.ts", mount: "/api/v1/profile", tag: "Profile" },
    {
      file: "coach-assignment/coach-assignment.routes.ts",
      mount: "/api/v1",
      tag: "Coach-assignment",
      routers: {
        coachRouter: "/api/v1/coach",
        clientCoachRouter: "/api/v1/client",
        requestsRouter: "/api/v1",
      },
    },
    { file: "client-questions/client-questions.routes.ts", mount: "/api/v1/client", tag: "Client-questions" },
    {
      file: "checkin/checkin.routes.ts",
      mount: "/api/v1",
      tag: "CheckIn",
      routers: {
        coachCheckInRouter: "/api/v1/coach/checkin",
        clientCheckInRouter: "/api/v1/client/checkin",
      },
    },
  ];

  for (const routeFile of routeFiles) {
    const filePath = path.join(ROUTES_DIR, routeFile.file);
    if (!fs.existsSync(filePath)) continue;

    const routes = extractRoutes(filePath);

    for (const route of routes) {
      const mount =
        (routeFile.routers && routeFile.routers[route.routerVar]) ||
        routeFile.mount;
      const routeSuffix = route.path === "/" ? "" : route.path;
      const openAPIPath = convertExpressPathToOpenAPI(routeSuffix);
      const fullPath = `${mount}${openAPIPath}`;

      if (!spec.paths[fullPath]) {
        spec.paths[fullPath] = {};
      }

      const operation: any = {
        tags: [routeFile.tag],
        security: getAuthRequirements(route.middleware),
        parameters: generateParameters(route.path, route.method, fullPath),
        responses: {
          "200": { description: "Success", content: getResponseContent(route.method, fullPath, "200") },
          "201": { description: "Created", content: getResponseContent(route.method, fullPath, "201") },
          "400": { description: "Bad request", content: errorBody },
          "401": { description: "Unauthorized", content: errorBody },
          "403": { description: "Forbidden", content: errorBody },
          "404": { description: "Not found", content: errorBody },
        },
      };

      const bodySpec = getRequestBodySpec(route.method, fullPath, route.path);
      if (bodySpec) {
        operation.requestBody = {
          required: true,
          content: {
            [bodySpec.contentType]: { schema: bodySpec.schema },
          },
        };
      }

      spec.paths[fullPath][route.method] = operation;
    }
  }

  return spec;
}

function main() {
  console.log("Generating OpenAPI specification...\n");

  const spec = generateOpenAPISpec();

  const specPath = path.join(__dirname, "../openapi.json");
  fs.writeFileSync(specPath, JSON.stringify(spec, null, 2));

  console.log(`OpenAPI spec generated: ${specPath}`);
  console.log(`Total paths: ${Object.keys(spec.paths).length}`);

  let totalOperations = 0;
  for (const path of Object.values(spec.paths)) {
    totalOperations += Object.keys(path).length;
  }
  console.log(`Total operations: ${totalOperations}`);
}

main();
