#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SAFE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/;
const ARTIFACT_TYPES = new Set(["assets", "database", "globals", "metadata"]);
const RETENTION_CLASSES = new Set(["hourly", "daily", "weekly", "monthly"]);

function fail(message) {
  console.error(`[backup-manifest][error] ${message}`);
  process.exitCode = 1;
}

function requireSafeToken(name, value) {
  if (!value || !SAFE_TOKEN.test(value) || value.includes("..")) {
    throw new Error(`${name}_invalid`);
  }
  return value;
}

function requirePlainBasename(name, value) {
  if (!value || path.basename(value) !== value || !SAFE_FILENAME.test(value)) {
    throw new Error(`${name}_invalid`);
  }
  return value;
}

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

function parseCreateArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error("arguments_invalid");
    options[key.slice(2)] = value;
  }
  return options;
}

async function createManifest(args) {
  const options = parseCreateArgs(args);
  const artifactPath = options.artifact;
  const sourcePath = options.source;
  const outputPath = options.output;
  if (!artifactPath || !sourcePath || !outputPath) {
    throw new Error("artifact_source_output_required");
  }
  if (
    path.resolve(outputPath) !== path.resolve(`${artifactPath}.manifest.json`)
  ) {
    throw new Error("manifest_artifact_name_mismatch");
  }
  if (!ARTIFACT_TYPES.has(options.type)) throw new Error("type_invalid");
  if (!RETENTION_CLASSES.has(options["retention-class"])) {
    throw new Error("retention_class_invalid");
  }

  const artifactName = requirePlainBasename(
    "artifact_name",
    path.basename(artifactPath),
  );
  const sourceName = requirePlainBasename(
    "source_name",
    path.basename(sourcePath),
  );
  const environment = requireSafeToken("environment", options.environment);
  const backupId = requireSafeToken("backup_id", options["backup-id"]);
  const commitSha = requireSafeToken("commit_sha", options["commit-sha"]);
  if (!["none", "openpgp"].includes(options.encryption)) {
    throw new Error("encryption_invalid");
  }
  const generatedAt = new Date(options["generated-at"]);
  if (Number.isNaN(generatedAt.getTime()))
    throw new Error("generated_at_invalid");

  const [artifactInfo, sourceInfo, digest] = await Promise.all([
    lstat(artifactPath),
    lstat(sourcePath),
    sha256(artifactPath),
  ]);
  if (
    !artifactInfo.isFile() ||
    artifactInfo.isSymbolicLink() ||
    !sourceInfo.isFile() ||
    sourceInfo.isSymbolicLink()
  ) {
    throw new Error("regular_file_required");
  }

  const manifest = {
    schemaVersion: "erp4.backup.manifest.v1",
    backupId,
    generatedAt: generatedAt.toISOString(),
    environment,
    retentionClass: options["retention-class"],
    artifact: {
      type: options.type,
      name: artifactName,
      sourceName,
      sourceSizeBytes: sourceInfo.size,
      sizeBytes: artifactInfo.size,
      sha256: digest,
    },
    encryption: {
      algorithm: options.encryption,
    },
    database: {
      name: options["database-name"] || null,
      version: options["database-version"] || null,
      schemaVersion: options["schema-version"] || null,
    },
    application: {
      version: options["app-version"] || null,
      commitSha,
    },
  };
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  console.log("[backup-manifest] created: true");
}

async function verifyManifest(args) {
  const options = parseCreateArgs(args);
  if (!options.artifact || !options.manifest) {
    throw new Error("artifact_manifest_required");
  }
  const [manifestInfo, artifactInfo] = await Promise.all([
    lstat(options.manifest),
    lstat(options.artifact),
  ]);
  if (
    !manifestInfo.isFile() ||
    manifestInfo.isSymbolicLink() ||
    !artifactInfo.isFile() ||
    artifactInfo.isSymbolicLink()
  ) {
    throw new Error("regular_file_required");
  }
  const manifest = JSON.parse(await readFile(options.manifest, "utf8"));
  const artifactName = requirePlainBasename(
    "artifact_name",
    path.basename(options.artifact),
  );
  const manifestGeneratedAt = new Date(manifest.generatedAt);
  if (
    manifest.schemaVersion !== "erp4.backup.manifest.v1" ||
    manifest.artifact?.name !== artifactName ||
    !ARTIFACT_TYPES.has(manifest.artifact?.type) ||
    !RETENTION_CLASSES.has(manifest.retentionClass) ||
    requirePlainBasename("source_name", manifest.artifact?.sourceName) !==
      manifest.artifact.sourceName ||
    requireSafeToken("backup_id", manifest.backupId) !== manifest.backupId ||
    requireSafeToken("environment", manifest.environment) !==
      manifest.environment ||
    requireSafeToken("commit_sha", manifest.application?.commitSha) !==
      manifest.application.commitSha ||
    !Number.isSafeInteger(manifest.artifact?.sourceSizeBytes) ||
    manifest.artifact.sourceSizeBytes < 0 ||
    !Number.isSafeInteger(manifest.artifact?.sizeBytes) ||
    manifest.artifact.sizeBytes < 0 ||
    !["none", "openpgp"].includes(manifest.encryption?.algorithm) ||
    Number.isNaN(manifestGeneratedAt.getTime()) ||
    manifestGeneratedAt.toISOString() !== manifest.generatedAt ||
    !/^[a-f0-9]{64}$/.test(manifest.artifact?.sha256 ?? "")
  ) {
    throw new Error("manifest_invalid");
  }
  const expected = {
    type: options.type,
    backupId: options["backup-id"],
    environment: options.environment,
    retentionClass: options["retention-class"],
    commitSha: options["commit-sha"],
    generatedAt: options["generated-at"],
    databaseVersion: options["database-version"],
    schemaVersion: options["schema-version"],
    appVersion: options["app-version"],
    encryption: options.encryption,
  };
  if (
    (expected.type && manifest.artifact?.type !== expected.type) ||
    (expected.backupId && manifest.backupId !== expected.backupId) ||
    (expected.environment && manifest.environment !== expected.environment) ||
    (expected.retentionClass &&
      manifest.retentionClass !== expected.retentionClass) ||
    (expected.commitSha &&
      manifest.application?.commitSha !== expected.commitSha) ||
    (expected.generatedAt && manifest.generatedAt !== expected.generatedAt) ||
    (expected.databaseVersion &&
      manifest.database?.version !== expected.databaseVersion) ||
    (expected.schemaVersion &&
      manifest.database?.schemaVersion !== expected.schemaVersion) ||
    (expected.appVersion &&
      manifest.application?.version !== expected.appVersion) ||
    (expected.encryption &&
      expected.encryption !== "any" &&
      manifest.encryption?.algorithm !== expected.encryption)
  ) {
    throw new Error("manifest_context_mismatch");
  }
  const digest = await sha256(options.artifact);
  if (
    artifactInfo.size !== manifest.artifact.sizeBytes ||
    digest !== manifest.artifact.sha256
  ) {
    throw new Error("artifact_integrity_mismatch");
  }
  console.log("[backup-manifest] verified: true");
}

const [command, ...args] = process.argv.slice(2);
try {
  if (command === "create") await createManifest(args);
  else if (command === "verify") await verifyManifest(args);
  else throw new Error("command_invalid");
} catch (error) {
  fail(error instanceof Error ? error.message : "unknown_error");
}
