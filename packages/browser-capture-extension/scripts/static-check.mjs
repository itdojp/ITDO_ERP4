import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertNoForbiddenExtensionCapabilities } from "./forbidden-capabilities.mjs";

const packageDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const sourceDir = path.join(packageDir, "src");

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const absolute = path.join(dir, name);
    return statSync(absolute).isDirectory() ? files(absolute) : [absolute];
  });
}

const sourceFiles = files(sourceDir);
for (const file of sourceFiles.filter((candidate) =>
  candidate.endsWith(".js"),
)) {
  execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
}

if (!process.argv.includes("--syntax")) {
  const joined = sourceFiles
    .filter((candidate) => candidate.endsWith(".js"))
    .map((candidate) => readFileSync(candidate, "utf8"))
    .join("\n");
  assertNoForbiddenExtensionCapabilities(joined, "extension source");
}

process.stdout.write("browser capture extension static checks passed\n");
