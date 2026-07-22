#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const CLASSES = ["hourly", "daily", "weekly", "monthly"];
const ARTIFACT_TYPES = new Set(["assets", "database", "globals", "metadata"]);
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/;

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error("arguments_invalid");
    options[key.slice(2)] = value;
  }
  return options;
}

function normalizePrefix(value) {
  const prefix = value?.replace(/^\/+|\/+$/g, "");
  const segments = prefix?.split("/") ?? [];
  if (
    segments.length === 0 ||
    segments.some((segment) => !SAFE_SEGMENT.test(segment) || segment === "..")
  ) {
    throw new Error("prefix_invalid");
  }
  return segments.join("/");
}

function parseNonNegativeInteger(name, value, fallback) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`${name}_invalid`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name}_invalid`);
  return parsed;
}

function cutoffFor(retentionClass, now) {
  const cutoff = new Date(now);
  if (retentionClass === "hourly")
    cutoff.setUTCHours(cutoff.getUTCHours() - 48);
  if (retentionClass === "daily") cutoff.setUTCDate(cutoff.getUTCDate() - 30);
  if (retentionClass === "weekly") cutoff.setUTCDate(cutoff.getUTCDate() - 84);
  if (retentionClass === "monthly") {
    const originalDay = cutoff.getUTCDate();
    cutoff.setUTCDate(1);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - 13);
    const lastDay = new Date(
      Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth() + 1, 0),
    ).getUTCDate();
    cutoff.setUTCDate(Math.min(originalDay, lastDay));
  }
  return cutoff;
}

function generatedAtFromBundle(bundle) {
  const backupId = bundle.split("/").at(-1);
  const match = backupId?.match(
    /-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-[a-fA-F0-9]{7,64}$/,
  );
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const value = new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    ),
  );
  if (
    value.getUTCFullYear() !== Number(year) ||
    value.getUTCMonth() !== Number(month) - 1 ||
    value.getUTCDate() !== Number(day) ||
    value.getUTCHours() !== Number(hour) ||
    value.getUTCMinutes() !== Number(minute) ||
    value.getUTCSeconds() !== Number(second)
  ) {
    return null;
  }
  return value;
}

function parseObject(entry, prefix) {
  if (
    typeof entry?.Key !== "string" ||
    typeof entry?.LastModified !== "string"
  ) {
    throw new Error("inventory_entry_invalid");
  }
  if (!entry.Key.startsWith(`${prefix}/`)) return null;
  const relative = entry.Key.slice(prefix.length + 1);
  const segments = relative.split("/");
  if (
    segments.some(
      (segment) => !segment || segment === ".." || !SAFE_SEGMENT.test(segment),
    )
  ) {
    return { invalid: entry.Key };
  }
  const retentionClass = segments[0];
  const typeIndex = segments.findIndex((segment) =>
    ARTIFACT_TYPES.has(segment),
  );
  if (
    !CLASSES.includes(retentionClass) ||
    typeIndex < 2 ||
    typeIndex !== segments.length - 2
  ) {
    return { invalid: entry.Key };
  }
  const filename = segments.at(-1);
  const manifest = filename.endsWith(".manifest.json");
  const artifactName = manifest
    ? filename.slice(0, -".manifest.json".length)
    : filename;
  if (!artifactName || !SAFE_SEGMENT.test(artifactName))
    return { invalid: entry.Key };
  const modifiedAt = new Date(entry.LastModified);
  if (Number.isNaN(modifiedAt.getTime()))
    throw new Error("inventory_timestamp_invalid");
  const bundle = segments.slice(0, typeIndex).join("/");
  const generatedAt = generatedAtFromBundle(bundle);
  if (!generatedAt) return { invalid: entry.Key };
  const year = String(generatedAt.getUTCFullYear()).padStart(4, "0");
  const month = String(generatedAt.getUTCMonth() + 1).padStart(2, "0");
  const day = String(generatedAt.getUTCDate()).padStart(2, "0");
  const backupId = segments[typeIndex - 1];
  const expectedBundleSegments =
    retentionClass === "hourly"
      ? [retentionClass, year, month, day, backupId]
      : retentionClass === "daily"
        ? [retentionClass, year, month, backupId]
        : [retentionClass, year, backupId];
  if (
    segments.slice(0, typeIndex).join("/") !== expectedBundleSegments.join("/")
  ) {
    return { invalid: entry.Key };
  }
  return {
    key: entry.Key,
    retentionClass,
    bundle,
    artifactType: segments[typeIndex],
    artifactName,
    manifest,
    modifiedAt,
    generatedAt,
  };
}

function analyzeInventory(
  contents,
  prefix,
  provider,
  targetFingerprint,
  now,
  minimums,
  inventorySha256,
) {
  const invalidKeys = [];
  const bundles = new Map();
  const seenKeys = new Set();
  for (const entry of contents) {
    const parsed = parseObject(entry, prefix);
    if (!parsed) continue;
    if (parsed.invalid) {
      invalidKeys.push(parsed.invalid);
      continue;
    }
    if (seenKeys.has(parsed.key)) {
      invalidKeys.push(parsed.key);
      continue;
    }
    seenKeys.add(parsed.key);
    const bundle = bundles.get(parsed.bundle) ?? {
      retentionClass: parsed.retentionClass,
      generatedAt: parsed.generatedAt,
      objects: [],
      pairs: new Map(),
    };
    if (bundle.generatedAt.getTime() !== parsed.generatedAt.getTime()) {
      invalidKeys.push(parsed.key);
      continue;
    }
    bundle.objects.push(parsed.key);
    const pairKey = `${parsed.artifactType}/${parsed.artifactName}`;
    const pair = bundle.pairs.get(pairKey) ?? {
      artifact: false,
      manifest: false,
    };
    pair[parsed.manifest ? "manifest" : "artifact"] = true;
    bundle.pairs.set(pairKey, pair);
    bundles.set(parsed.bundle, bundle);
  }

  const incompleteBundles = [];
  const completeByClass = Object.fromEntries(CLASSES.map((name) => [name, []]));
  for (const [name, bundle] of bundles) {
    const typeCounts = new Map();
    const orphaned = [];
    for (const [pairKey, pair] of bundle.pairs) {
      const artifactType = pairKey.split("/")[0];
      typeCounts.set(artifactType, (typeCounts.get(artifactType) ?? 0) + 1);
      if (!pair.artifact || !pair.manifest) orphaned.push(pairKey);
    }
    const missingTypes = ["database", "globals", "metadata"].filter(
      (type) => (typeCounts.get(type) ?? 0) !== 1,
    );
    const duplicateTypes = [...typeCounts]
      .filter(([, count]) => count > 1)
      .map(([type]) => type)
      .sort();
    const complete =
      orphaned.length === 0 &&
      missingTypes.length === 0 &&
      duplicateTypes.length === 0;
    if (!complete) {
      incompleteBundles.push({
        bundle: name,
        orphaned,
        missingTypes,
        duplicateTypes,
      });
      continue;
    }
    completeByClass[bundle.retentionClass].push({
      bundle: name,
      generatedAt: bundle.generatedAt,
      keys: [...bundle.objects].sort(),
    });
  }

  const deleteBundles = [];
  const classSummary = {};
  for (const retentionClass of CLASSES) {
    const bundlesForClass = completeByClass[retentionClass].sort(
      (left, right) => right.generatedAt - left.generatedAt,
    );
    const cutoff = cutoffFor(retentionClass, now);
    const protectedBundles = new Set(
      bundlesForClass
        .slice(0, minimums[retentionClass])
        .map((item) => item.bundle),
    );
    const candidates = bundlesForClass.filter(
      (item) => item.generatedAt < cutoff && !protectedBundles.has(item.bundle),
    );
    deleteBundles.push(...candidates);
    classSummary[retentionClass] = {
      completeBundles: bundlesForClass.length,
      minimumProtected: minimums[retentionClass],
      cutoff: cutoff.toISOString(),
      deleteBundles: candidates.length,
    };
  }

  return {
    schemaVersion: "erp4.backup.retention-plan.v1",
    generatedAt: now.toISOString(),
    inventorySha256,
    prefix,
    provider,
    targetFingerprint,
    minimums,
    applyAllowed: invalidKeys.length === 0 && incompleteBundles.length === 0,
    invalidKeys: invalidKeys.sort(),
    incompleteBundles,
    classes: classSummary,
    deleteBundles: deleteBundles.map((item) => item.bundle).sort(),
    deleteKeys: deleteBundles.flatMap((item) => item.keys).sort(),
  };
}

function toMarkdown(plan) {
  const lines = [
    "# ERP4 backup retention plan",
    "",
    `- Generated at: \`${plan.generatedAt}\``,
    `- Prefix: \`${plan.prefix}\``,
    `- Apply allowed: \`${plan.applyAllowed}\``,
    `- Invalid keys: \`${plan.invalidKeys.length}\``,
    `- Incomplete bundles: \`${plan.incompleteBundles.length}\``,
    `- Delete bundles: \`${plan.deleteBundles.length}\``,
    `- Delete objects: \`${plan.deleteKeys.length}\``,
    "",
    "## Retention classes",
    "",
  ];
  for (const name of CLASSES) {
    const item = plan.classes[name];
    lines.push(
      `- ${name}: complete=${item.completeBundles}, minimum=${item.minimumProtected}, delete=${item.deleteBundles}, cutoff=\`${item.cutoff}\``,
    );
  }
  lines.push("", "## Delete bundles", "");
  if (plan.deleteBundles.length === 0) lines.push("- none");
  else for (const bundle of plan.deleteBundles) lines.push(`- \`${bundle}\``);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (
    !options.inventory ||
    !options.prefix ||
    !options.provider ||
    !options["target-fingerprint"] ||
    !options["json-out"] ||
    !options["markdown-out"]
  ) {
    throw new Error("inventory_prefix_outputs_required");
  }
  const prefix = normalizePrefix(options.prefix);
  if (!["aws", "sakura"].includes(options.provider))
    throw new Error("provider_invalid");
  if (!/^[a-f0-9]{64}$/.test(options["target-fingerprint"])) {
    throw new Error("target_fingerprint_invalid");
  }
  const now = new Date(options.now ?? new Date().toISOString());
  if (Number.isNaN(now.getTime())) throw new Error("now_invalid");
  const minimums = Object.fromEntries(
    CLASSES.map((name) => [
      name,
      parseNonNegativeInteger(`min_${name}`, options[`min-${name}`], undefined),
    ]),
  );
  if (Object.values(minimums).some((value) => value === undefined)) {
    throw new Error("all_minimum_generations_are_required");
  }
  const inventoryRaw = await readFile(options.inventory, "utf8");
  const inventorySha256 = createHash("sha256")
    .update(inventoryRaw)
    .digest("hex");
  const inventory = JSON.parse(inventoryRaw);
  const contents = inventory.Contents ?? [];
  if (!Array.isArray(contents)) throw new Error("inventory_invalid");
  const plan = analyzeInventory(
    contents,
    prefix,
    options.provider,
    options["target-fingerprint"],
    now,
    minimums,
    inventorySha256,
  );
  await writeFile(options["json-out"], `${JSON.stringify(plan, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  await writeFile(options["markdown-out"], toMarkdown(plan), {
    flag: "wx",
    mode: 0o600,
  });
  console.log(`[backup-retention] apply allowed: ${plan.applyAllowed}`);
  console.log(`[backup-retention] delete objects: ${plan.deleteKeys.length}`);
} catch (error) {
  console.error(
    `[backup-retention][error] ${error instanceof Error ? error.message : "unknown_error"}`,
  );
  process.exitCode = 1;
}
