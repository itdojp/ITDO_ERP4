// Clear Annotation(JSON) shadow refs when ReferenceLink rows already represent
// the same effective state.
//
// Usage:
//   node scripts/shrink-annotation-reference-shadow.mjs
//   node scripts/shrink-annotation-reference-shadow.mjs --apply
//   node scripts/shrink-annotation-reference-shadow.mjs --apply --batch-size=100 --limit-targets=500
//   node scripts/shrink-annotation-reference-shadow.mjs --target-kind=invoice --target-id=inv-001
//
// Note:
//   - Run `npm run build --prefix packages/backend` beforehand.
//   - This script imports backend dist modules.
//   - `--limit-targets` caps the number of Annotation rows scanned in one run.

import { prisma } from "../packages/backend/dist/services/db.js";
import { shrinkAnnotationReferenceShadow } from "../packages/backend/dist/services/annotationReferences.js";

function parseArgValue(key) {
  const prefix = `--${key}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function shouldShowHelp() {
  return hasFlag("--help") || hasFlag("-h");
}

function parsePositiveInt(name, value) {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`invalid --${name}: ${value} (expected: positive number)`);
  }
  return Math.floor(parsed);
}

function printHelp() {
  console.log(
    [
      "Usage: node scripts/shrink-annotation-reference-shadow.mjs [--apply] [--batch-size=N] [--limit-targets=N] [--target-kind=KIND] [--target-id=ID]",
      "",
      "Examples:",
      "  node scripts/shrink-annotation-reference-shadow.mjs",
      "  node scripts/shrink-annotation-reference-shadow.mjs --apply",
      "  node scripts/shrink-annotation-reference-shadow.mjs --apply --batch-size=100 --limit-targets=500",
      "  node scripts/shrink-annotation-reference-shadow.mjs --target-kind=invoice --target-id=inv-001",
    ].join("\n"),
  );
}

async function main() {
  if (shouldShowHelp()) {
    printHelp();
    return;
  }

  const summary = await shrinkAnnotationReferenceShadow(prisma, {
    dryRun: !hasFlag("--apply"),
    batchSize: parsePositiveInt("batch-size", parseArgValue("batch-size")),
    limitTargets: parsePositiveInt(
      "limit-targets",
      parseArgValue("limit-targets"),
    ),
    targetKind: parseArgValue("target-kind"),
    targetId: parseArgValue("target-id"),
  });

  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    console.error(
      error instanceof Error ? error.message : String(error || "unknown_error"),
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
