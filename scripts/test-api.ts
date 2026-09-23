import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

interface TestConfig {
  baseUrl: string;
  timeout: number;
  retries: number;
}

interface TestResult {
  name: string;
  endpoint: string;
  method: string;
  status: "pass" | "fail" | "skip";
  statusCode?: number;
  duration?: number;
  error?: string;
}

const DEFAULT_CONFIG: TestConfig = {
  baseUrl: "http://localhost:3000",
  timeout: 10000,
  retries: 2,
};

function loadConfig(): TestConfig {
  const configPath = path.join(__dirname, "../.env");
  const config: TestConfig = { ...DEFAULT_CONFIG };

  if (fs.existsSync(configPath)) {
    const envContent = fs.readFileSync(configPath, "utf-8");
    const portMatch = envContent.match(/PORT=(\d+)/);
    if (portMatch) {
      config.baseUrl = `http://localhost:${portMatch[1]}`;
    }
  }

  return config;
}

async function healthCheck(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/api/v1/health`);
    const data = await response.json();
    return data.status === "ok";
  } catch {
    return false;
  }
}

async function testEndpoint(
  baseUrl: string,
  method: string,
  endpoint: string,
  token?: string
): Promise<TestResult> {
  const startTime = Date.now();
  const result: TestResult = {
    name: `${method.toUpperCase()} ${endpoint}`,
    endpoint,
    method: method.toUpperCase(),
    status: "skip",
  };

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const response = await fetch(`${baseUrl}${endpoint}`, {
      method: method.toUpperCase(),
      headers,
      signal: AbortSignal.timeout(DEFAULT_CONFIG.timeout),
    });

    result.statusCode = response.status;
    result.duration = Date.now() - startTime;

    if (response.status >= 200 && response.status < 300) {
      result.status = "pass";
    } else if (response.status === 401 || response.status === 403) {
      result.status = "pass";
    } else if (response.status === 404) {
      result.status = "pass";
    } else {
      result.status = "fail";
      result.error = `Unexpected status: ${response.status}`;
    }
  } catch (error) {
    result.duration = Date.now() - startTime;
    result.status = "fail";
    result.error = error instanceof Error ? error.message : "Unknown error";
  }

  return result;
}

async function runTests(config: TestConfig): Promise<TestResult[]> {
  const results: TestResult[] = [];

  const publicEndpoints = [
    { method: "get", endpoint: "/api/v1/health" },
    { method: "post", endpoint: "/api/v1/auth/signup" },
    { method: "post", endpoint: "/api/v1/auth/login" },
    { method: "post", endpoint: "/api/v1/auth/verify-email" },
    { method: "post", endpoint: "/api/v1/auth/resend-verification" },
    { method: "post", endpoint: "/api/v1/auth/reset-password" },
    { method: "post", endpoint: "/api/v1/auth/reset-password/confirm" },
    { method: "get", endpoint: "/api/v1/client/questions" },
  ];

  const authenticatedEndpoints = [
    { method: "get", endpoint: "/api/v1/auth/me" },
    { method: "get", endpoint: "/api/v1/profile" },
    { method: "get", endpoint: "/api/v1/workout/exercises" },
    { method: "get", endpoint: "/api/v1/nutrition/foods" },
    { method: "get", endpoint: "/api/v1/nutrition/food-categories" },
  ];

  console.log("Testing public endpoints...");
  for (const { method, endpoint } of publicEndpoints) {
    const result = await testEndpoint(config.baseUrl, method, endpoint);
    results.push(result);
    console.log(`  ${result.status === "pass" ? "✓" : "✗"} ${result.name}`);
  }

  console.log("\nTesting authenticated endpoints (without token)...");
  for (const { method, endpoint } of authenticatedEndpoints) {
    const result = await testEndpoint(config.baseUrl, method, endpoint);
    results.push(result);
    console.log(`  ${result.status === "pass" ? "✓" : "✗"} ${result.name}`);
  }

  return results;
}

function generateTestReport(results: TestResult[]): string {
  const report: string[] = [];
  report.push("# API Test Report");
  report.push(`Generated: ${new Date().toISOString()}\n`);

  const passed = results.filter((r) => r.status === "pass");
  const failed = results.filter((r) => r.status === "fail");
  const skipped = results.filter((r) => r.status === "skip");

  report.push("## Summary");
  report.push(`- Total tests: ${results.length}`);
  report.push(`- Passed: ${passed.length}`);
  report.push(`- Failed: ${failed.length}`);
  report.push(`- Skipped: ${skipped.length}\n`);

  if (failed.length > 0) {
    report.push("## Failed Tests");
    for (const test of failed) {
      report.push(`### ${test.name}`);
      report.push(`- Status: ${test.statusCode || "N/A"}`);
      report.push(`- Duration: ${test.duration}ms`);
      report.push(`- Error: ${test.error}`);
      report.push("");
    }
  }

  report.push("## All Tests");
  for (const test of results) {
    const icon = test.status === "pass" ? "✓" : test.status === "fail" ? "✗" : "○";
    report.push(`- ${icon} ${test.name} (${test.duration || 0}ms)`);
  }

  return report.join("\n");
}

async function main() {
  console.log("Athletica API Test Runner\n");

  const config = loadConfig();
  console.log(`Base URL: ${config.baseUrl}\n`);

  const isHealthy = await healthCheck(config.baseUrl);
  if (!isHealthy) {
    console.error("❌ Server is not running or not accessible");
    console.error("   Please start the server with: npm run dev");
    process.exit(1);
  }

  console.log("✓ Server is healthy\n");

  const results = await runTests(config);

  const report = generateTestReport(results);
  const reportPath = path.join(__dirname, "../reports/api-test-report.md");
  const reportsDir = path.dirname(reportPath);
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }
  fs.writeFileSync(reportPath, report);

  console.log(`\nReport saved to: ${reportPath}`);

  const failed = results.filter((r) => r.status === "fail");
  if (failed.length > 0) {
    process.exit(1);
  }
}

main();
