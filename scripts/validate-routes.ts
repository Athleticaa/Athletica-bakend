import * as fs from "fs";
import * as path from "path";

interface RouteInfo {
  method: string;
  path: string;
  middleware: string[];
  file: string;
  lineNumber: number;
  routerVar: string;
}

interface ValidationSchema {
  name: string;
  fields: Record<string, { type: string; required: boolean; constraints?: string }>;
  file: string;
}

interface ValidationResult {
  route: string;
  method: string;
  issues: string[];
  severity: "error" | "warning";
}

const ROUTES_DIR = path.join(__dirname, "../src/modules");
const VALIDATION_DIR = path.join(__dirname, "../src/modules");

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
      if (routerVar.toLowerCase() === "express") continue;
      const method = match[2].toUpperCase();
      const routePath = match[3];
      const middlewareStr = match[4] || "";
      const middleware = middlewareStr
        .split(",")
        .map((m) => m.trim())
        .filter((m) => m && !m.includes("controller"));

      routes.push({
        method,
        path: routePath,
        middleware,
        file: filePath,
        lineNumber: i + 1,
        routerVar,
      });
    }
  }

  return routes;
}

function extractValidationSchemas(filePath: string): ValidationSchema[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const schemas: ValidationSchema[] = [];

  const interfaceRegex = /export\s+interface\s+(\w+Input)\s*\{([^}]+)\}/g;
  let match;

  while ((match = interfaceRegex.exec(content)) !== null) {
    const name = match[1];
    const fieldsStr = match[2];
    const fields: Record<string, { type: string; required: boolean; constraints?: string }> = {};

    const fieldLines = fieldsStr.split("\n");
    for (const fieldLine of fieldLines) {
      const fieldMatch = fieldLine.match(/(\w+)(\?)?\s*:\s*([^;]+)/);
      if (fieldMatch) {
        const fieldName = fieldMatch[1];
        const optional = fieldMatch[2] === "?";
        const type = fieldMatch[3].trim();
        fields[fieldName] = { type, required: !optional };
      }
    }

    schemas.push({ name, fields, file: filePath });
  }

  return schemas;
}

function validateRoutes(): ValidationResult[] {
  const results: ValidationResult[] = [];

  const routeFiles = [
    "auth/auth.routes.ts",
    "workout/workout.routes.ts",
    "nutrition/nutrition.routes.ts",
    "profile/profile.routes.ts",
    "coach-assignment/coach-assignment.routes.ts",
    "client-questions/client-questions.routes.ts",
    "checkin/checkin.routes.ts",
  ];

  const allRoutes: RouteInfo[] = [];

  for (const routeFile of routeFiles) {
    const filePath = path.join(ROUTES_DIR, routeFile);
    if (fs.existsSync(filePath)) {
      const routes = extractRoutes(filePath);
      allRoutes.push(...routes);
    }
  }

  const routeGroups: Record<string, RouteInfo[]> = {};
  for (const route of allRoutes) {
    // Include file + router var so coach/client check-in routers sharing
    // the same sub-path (e.g. GET /questions) are not flagged as duplicates.
    const key = `${route.method}:${path.basename(route.file)}:${route.routerVar}:${route.path}`;
    if (!routeGroups[key]) {
      routeGroups[key] = [];
    }
    routeGroups[key].push(route);
  }

  for (const [key, routes] of Object.entries(routeGroups)) {
    const uniqueFiles = new Set(routes.map((r) => path.basename(r.file)));
    if (routes.length > 1 && uniqueFiles.size > 1) {
      results.push({
        route: routes[0].path,
        method: routes[0].method,
        issues: [`Duplicate route definition found in ${uniqueFiles.size} different modules`],
        severity: "warning",
      });
    }
  }

  for (const route of allRoutes) {
    const issues: string[] = [];
    const isAuthModule = route.file.includes("auth");
    const isPublicAuthEndpoint =
      isAuthModule &&
      (route.path === "/signup" ||
        route.path === "/login" ||
        route.path === "/reset-password" ||
        route.path === "/reset-password/confirm" ||
        route.path === "/verify-email" ||
        route.path === "/resend-verification");

    if (route.path.includes(":id") && !route.middleware.includes("authenticate")) {
      issues.push("Route with :id param should require authentication");
    }

    if (
      (route.method === "POST" || route.method === "PUT" || route.method === "PATCH") &&
      !route.path.includes(":id") &&
      !route.middleware.includes("authenticate") &&
      !isPublicAuthEndpoint
    ) {
      issues.push("Mutation route without authentication");
    }

    if (route.path.includes("/delete") && route.method !== "DELETE") {
      issues.push("Route contains '/delete' but uses wrong HTTP method");
    }

    if (issues.length > 0) {
      results.push({
        route: route.path,
        method: route.method,
        issues,
        severity: "error",
      });
    }
  }

  return results;
}

function generateReport(results: ValidationResult[]): string {
  const report: string[] = [];
  report.push("# API Route Validation Report");
  report.push(`Generated: ${new Date().toISOString()}\n`);

  const errors = results.filter((r) => r.severity === "error");
  const warnings = results.filter((r) => r.severity === "warning");

  report.push(`## Summary`);
  report.push(`- Total issues: ${results.length}`);
  report.push(`- Errors: ${errors.length}`);
  report.push(`- Warnings: ${warnings.length}\n`);

  if (errors.length > 0) {
    report.push("## Errors");
    for (const error of errors) {
      report.push(`### ${error.method} ${error.route}`);
      for (const issue of error.issues) {
        report.push(`- ❌ ${issue}`);
      }
      report.push("");
    }
  }

  if (warnings.length > 0) {
    report.push("## Warnings");
    for (const warning of warnings) {
      report.push(`### ${warning.method} ${warning.route}`);
      for (const issue of warning.issues) {
        report.push(`- ⚠️ ${issue}`);
      }
      report.push("");
    }
  }

  if (results.length === 0) {
    report.push("✅ No issues found!");
  }

  return report.join("\n");
}

function main() {
  console.log("Validating API routes...\n");

  const results = validateRoutes();
  const report = generateReport(results);

  const reportPath = path.join(__dirname, "../reports/api-validation-report.md");
  const reportsDir = path.dirname(reportPath);
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }
  fs.writeFileSync(reportPath, report);

  console.log(report);
  console.log(`\nReport saved to: ${reportPath}`);

  if (results.some((r) => r.severity === "error")) {
    process.exit(1);
  }
}

main();
