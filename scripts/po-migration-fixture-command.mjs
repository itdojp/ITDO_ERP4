#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const backendDir = path.join(repoRoot, "packages/backend");
const modeArg = process.argv.find((arg) => arg.startsWith("--mode="));
const mode = modeArg ? modeArg.slice("--mode=".length) : "dry-run";
const allowedModes = new Set(["dry-run", "apply", "all"]);
if (!allowedModes.has(mode)) {
  throw new Error(`invalid --mode: ${mode}`);
}
const skipBuild = process.argv.includes("--skip-build");

const defaultDatabaseUrl =
  "postgresql://user:pass@localhost:5432/po_migration_fixture?schema=public";
const env = {
  ...process.env,
  DATABASE_URL: process.env.DATABASE_URL || defaultDatabaseUrl,
};
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const nodeCommand = process.execPath;

function run(label, command, args, cwd) {
  console.log(`[po-fixture] ${label}`);
  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status ?? 1}`);
  }
}

if (!skipBuild) {
  run(
    "generate Prisma client",
    npmCommand,
    ["run", "prisma:generate"],
    backendDir,
  );
  run("build backend", npmCommand, ["run", "build"], backendDir);
} else {
  console.log("[po-fixture] skip Prisma client generation and backend build");
}
run(
  `run PO migration fixture checks (${mode})`,
  nodeCommand,
  ["scripts/po-migration-fixture-runner.mjs", "--prepare-db", `--mode=${mode}`],
  repoRoot,
);
