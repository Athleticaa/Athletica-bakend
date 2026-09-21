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
      /router\.(get|post|put|delete|patch)\s*\(\s*["'`]([^"'`]+)["'`]\s*(?:,\s*(.+))?\)/i
    );
    if (match) {
      const method = match[1].toLowerCase();
      const routePath = match[2];
      const middlewareStr = match[3] || "";
      const middleware = middlewareStr
        .split(",")
        .map((m) => m.trim())
        .filter((m) => m && !m.includes("controller"));

      routes.push({
        method,
        path: routePath,
        middleware,
        file: filePath,
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

function getTags(filePath: string): string[] {
  const fileName = path.basename(filePath, ".routes.ts");
  return [fileName.charAt(0).toUpperCase() + fileName.slice(1)];
}

function generateRequestBody(method: string, routePath: string): any {
  if (method === "get" || method === "delete") {
    return undefined;
  }

  const schema: any = {
    type: "object",
    properties: {},
  };

  if (routePath.includes("/signup")) {
    schema.properties = {
      username: { type: "string", minLength: 1, maxLength: 100 },
      email: { type: "string", format: "email" },
      password: { type: "string", minLength: 8 },
      role: { type: "string", enum: ["coach", "client"] },
      gender: { type: "string" },
      goal: { type: "string" },
      bio: { type: "string" },
      specialization: { type: "string" },
    };
    schema.required = ["username", "email", "password", "role"];
  } else if (routePath.includes("/login")) {
    schema.properties = {
      email: { type: "string", format: "email" },
      password: { type: "string" },
    };
    schema.required = ["email", "password"];
  } else if (routePath.includes("/templates") && !routePath.includes("/days") && !routePath.includes("/exercises")) {
    schema.properties = {
      title: { type: "string", maxLength: 100 },
      description: { type: "string", maxLength: 500 },
    };
    schema.required = ["title", "description"];
  } else if (routePath.includes("/assign")) {
    schema.properties = {
      coach_client_id: { type: "string", format: "uuid" },
      title: { type: "string" },
      description: { type: "string" },
    };
    schema.required = ["coach_client_id"];
  } else if (routePath.includes("/exercises") && !routePath.includes("/complete") && !routePath.includes("/uncomplete")) {
    schema.properties = {
      exercise_id: { type: "string", format: "uuid" },
      exercise_order: { type: "integer", minimum: 1 },
      notes: { type: "string" },
    };
    schema.required = ["exercise_id"];
  } else if (routePath.includes("/meals") && !routePath.includes("/foods")) {
    schema.properties = {
      meal_type: { type: "string" },
      meal_order: { type: "integer", minimum: 1 },
      notes: { type: "string" },
    };
    schema.required = ["meal_type"];
  } else if (routePath.includes("/foods") && !routePath.includes("/complete") && !routePath.includes("/uncomplete")) {
    schema.properties = {
      food_id: { type: "string", format: "uuid" },
      quantity: { type: "number", minimum: 0 },
    };
    schema.required = ["food_id", "quantity"];
  } else if (routePath.includes("/reorder")) {
    schema.properties = {
      day_ids: { type: "array", items: { type: "string", format: "uuid" } },
    };
    schema.required = ["day_ids"];
  }

  if (Object.keys(schema.properties).length === 0) {
    return { type: "object" };
  }

  return schema;
}

function generateParameters(routePath: string, method: string): any[] {
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

  if (method === "get" && routePath.includes("/exercises")) {
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

  if (method === "get" && routePath.includes("/foods")) {
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

  const routeFiles = [
    "auth/auth.routes.ts",
    "workout/workout.routes.ts",
    "nutrition/nutrition.routes.ts",
    "profile/profile.routes.ts",
    "coach-assignment/coach-assignment.routes.ts",
    "client-questions/client-questions.routes.ts",
  ];

  for (const routeFile of routeFiles) {
    const filePath = path.join(ROUTES_DIR, routeFile);
    if (!fs.existsSync(filePath)) continue;

    const routes = extractRoutes(filePath);
    const tags = getTags(filePath);

    for (const route of routes) {
      const openAPIPath = convertExpressPathToOpenAPI(route.path);
      const fullPath = `/api/v1${openAPIPath}`;

      if (!spec.paths[fullPath]) {
        spec.paths[fullPath] = {};
      }

      const operation: any = {
        tags,
        security: getAuthRequirements(route.middleware),
        parameters: generateParameters(route.path, route.method),
        responses: {
          "200": { description: "Success" },
          "400": { description: "Bad request" },
          "401": { description: "Unauthorized" },
          "403": { description: "Forbidden" },
          "404": { description: "Not found" },
        },
      };

      const requestBody = generateRequestBody(route.method, route.path);
      if (requestBody) {
        operation.requestBody = {
          required: true,
          content: {
            "application/json": { schema: requestBody },
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
