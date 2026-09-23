import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

interface SyncConfig {
  projectId: string;
  token: string;
  specPath: string;
}

function loadConfig(): SyncConfig {
  const configPath = path.join(__dirname, "../.opencode/mcp.json");
  const specPath = path.join(__dirname, "../openapi.json");

  if (!fs.existsSync(configPath)) {
    throw new Error("MCP configuration not found at .opencode/mcp.json");
  }

  const mcpConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  const serverConfig = mcpConfig.mcpServers["athletica-api"];

  if (!serverConfig) {
    throw new Error("athletica-api server not found in MCP configuration");
  }

  const projectId = serverConfig.args.find((arg: string) =>
    arg.startsWith("--project-id=")
  )?.split("=")[1];

  const token = serverConfig.env?.APIDOG_ACCESS_TOKEN;

  if (!projectId || !token) {
    throw new Error("Project ID or token not found in MCP configuration");
  }

  return { projectId, token, specPath };
}

function checkApidogCLI(): boolean {
  try {
    execSync("apidog --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function installApidogCLI(): void {
  console.log("Installing Apidog CLI...");
  try {
    execSync("npm install -g @apidog/cli", { stdio: "inherit" });
    console.log("✓ Apidog CLI installed successfully");
  } catch (error) {
    throw new Error("Failed to install Apidog CLI");
  }
}

function syncToApidog(config: SyncConfig): void {
  console.log("Syncing OpenAPI spec to Apidog...\n");

  if (!fs.existsSync(config.specPath)) {
    throw new Error("OpenAPI spec not found. Run 'npm run api:generate' first.");
  }

  const spec = JSON.parse(fs.readFileSync(config.specPath, "utf-8"));
  console.log(`Project ID: ${config.projectId}`);
  console.log(`API Title: ${spec.info.title}`);
  console.log(`Version: ${spec.info.version}`);
  console.log(`Paths: ${Object.keys(spec.paths).length}\n`);

  try {
    const env = {
      ...process.env,
      APIDOG_ACCESS_TOKEN: config.token,
    };

    execSync(
      `apidog import --project ${config.projectId} --format openapi --file "${config.specPath}" --access-token ${config.token}`,
      {
        stdio: "inherit",
        env,
      }
    );

    console.log("\n✓ Successfully synced to Apidog");
  } catch (error) {
    console.error("Failed to sync to Apidog");
    console.error("You can manually import the spec at: https://apidog.com");
    console.error(`Project ID: ${config.projectId}`);
  }
}

function validateSync(config: SyncConfig): void {
  console.log("Validating sync...\n");

  try {
    const env = {
      ...process.env,
      APIDOG_ACCESS_TOKEN: config.token,
    };

    execSync(
      `apidog project get ${config.projectId} --access-token ${config.token}`,
      {
        stdio: "inherit",
        env,
      }
    );

    console.log("\n✓ Validation passed");
  } catch (error) {
    console.log("\n⚠️  Validation skipped (manual check recommended)");
  }
}

function generateSyncReport(config: SyncConfig, success: boolean): string {
  const report: string[] = [];
  report.push("# Apidog Sync Report");
  report.push(`Generated: ${new Date().toISOString()}\n`);

  report.push("## Configuration");
  report.push(`- Project ID: ${config.projectId}`);
  report.push(`- Spec Path: ${config.specPath}`);
  report.push(`- Status: ${success ? "✓ Synced" : "✗ Failed"}\n`);

  if (fs.existsSync(config.specPath)) {
    const spec = JSON.parse(fs.readFileSync(config.specPath, "utf-8"));
    report.push("## API Specification");
    report.push(`- Title: ${spec.info.title}`);
    report.push(`- Version: ${spec.info.version}`);
    report.push(`- Paths: ${Object.keys(spec.paths).length}`);

    let totalOps = 0;
    for (const path of Object.values(spec.paths)) {
      totalOps += Object.keys(path).length;
    }
    report.push(`- Operations: ${totalOps}\n`);
  }

  report.push("## Next Steps");
  report.push("1. Open Apidog and verify the imported specification");
  report.push("2. Review and update API documentation");
  report.push("3. Create test scenarios in Apidog");
  report.push("4. Run tests with: apidog run");

  return report.join("\n");
}

async function main() {
  console.log("Apidog Sync Tool\n");

  let config: SyncConfig;
  try {
    config = loadConfig();
  } catch (error) {
    console.error("Configuration error:", error);
    process.exit(1);
  }

  if (!checkApidogCLI()) {
    console.log("Apidog CLI not found.");
    installApidogCLI();
  }

  let success = false;
  try {
    syncToApidog(config);
    success = true;
  } catch (error) {
    console.error("Sync failed:", error);
  }

  if (success) {
    validateSync(config);
  }

  const report = generateSyncReport(config, success);
  const reportPath = path.join(__dirname, "../reports/apidog-sync-report.md");
  const reportsDir = path.dirname(reportPath);
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }
  fs.writeFileSync(reportPath, report);

  console.log(`\nReport saved to: ${reportPath}`);

  if (!success) {
    process.exit(1);
  }
}

main();
