import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRATCH = path.join(ROOT, ".codex-local", "tmp");

function withScratch(prefix, fn) {
  mkdirSync(SCRATCH, { recursive: true });
  const dir = mkdtempSync(path.join(SCRATCH, prefix));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function run(command, args, env = {}) {
  return spawnSync(command, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

function installFakeGpg(dir) {
  const bin = path.join(dir, "gpg-bin");
  const gpg = path.join(bin, "gpg");
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    gpg,
    `#!/usr/bin/env bash
set -euo pipefail
args=("$@")
value_after() {
  local needle="$1"
  for i in "\${!args[@]}"; do
    if [[ "\${args[$i]}" == "$needle" ]]; then printf '%s' "\${args[$((i + 1))]}"; return; fi
  done
}
if [[ " $* " == *' --list-packets '* ]]; then
  artifact="\${args[-1]}"
  grep -q '^ERP4-OPENPGP-TEST$' "$artifact" || exit 2
  printf ':pubkey enc packet: version 3, algo 1, keyid REDACTED\n'
  printf ':aead encrypted packet: cipher=9 aead=2 cb=16\n'
  exit 0
fi
output="$(value_after --output)"
source="\${args[-1]}"
printf 'ERP4-OPENPGP-TEST\n' >"$output"
cat "$source" >>"$output"
`,
  );
  chmodSync(gpg, 0o755);
  return bin;
}

function installFakeRestoreTools(dir) {
  const bin = path.join(dir, "restore-bin");
  mkdirSync(bin, { recursive: true });
  const tools = {
    gpg: `#!/usr/bin/env bash
set -euo pipefail
args=("$@")
printf 'gpg ' >>"$FAKE_RESTORE_LOG"
printf '%q ' "$@" >>"$FAKE_RESTORE_LOG"
printf '\n' >>"$FAKE_RESTORE_LOG"
[[ " $* " != *' --yes '* ]] || exit 91
output=''
for i in "\${!args[@]}"; do
  if [[ "\${args[$i]}" == --output ]]; then output="\${args[$((i + 1))]}"; fi
done
[[ -n "$output" ]]
cp -- "\${args[-1]}" "$output"
`,
    psql: `#!/usr/bin/env bash
set -euo pipefail
printf 'psql ' >>"$FAKE_RESTORE_LOG"
printf '%q ' "$@" >>"$FAKE_RESTORE_LOG"
printf '\n' >>"$FAKE_RESTORE_LOG"
`,
    pg_restore: `#!/usr/bin/env bash
set -euo pipefail
printf 'pg_restore ' >>"$FAKE_RESTORE_LOG"
printf '%q ' "$@" >>"$FAKE_RESTORE_LOG"
printf '\n' >>"$FAKE_RESTORE_LOG"
`,
  };
  for (const [name, contents] of Object.entries(tools)) {
    const file = path.join(bin, name);
    writeFileSync(file, contents);
    chmodSync(file, 0o755);
  }
  return bin;
}

function installFailingManifestMove(dir) {
  const bin = path.join(dir, "mv-bin");
  const mv = path.join(bin, "mv");
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    mv,
    `#!/usr/bin/env bash
set -euo pipefail
source_path="\${@: -2:1}"
destination_path="\${@: -1}"
if [[ "$source_path" == *backup-s3-download*/*.manifest.json && "$destination_path" == *.manifest.json ]]; then
  exit 70
fi
exec "$(command -p -v mv)" "$@"
`,
  );
  chmodSync(mv, 0o755);
  return bin;
}

function installFakeAws(dir) {
  const bin = path.join(dir, "bin");
  const aws = path.join(bin, "aws");
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    aws,
    `#!/usr/bin/env bash
set -euo pipefail
printf '%q ' "$@" >>"$FAKE_AWS_LOG"
printf '\n' >>"$FAKE_AWS_LOG"
args=("$@")
command_index=-1
for i in "\${!args[@]}"; do
  if [[ "\${args[$i]}" == s3 || "\${args[$i]}" == s3api ]]; then command_index=$i; break; fi
done
(( command_index >= 0 )) || exit 1
family="\${args[$command_index]}"
operation="\${args[$((command_index + 1))]}"
value_after() {
  local needle="$1"
  for i in "\${!args[@]}"; do
    if [[ "\${args[$i]}" == "$needle" ]]; then printf '%s' "\${args[$((i + 1))]}"; return; fi
  done
}
safe_key() { printf '%s' "$1" | sha256sum | cut -d' ' -f1; }
if [[ "$family" == s3api ]]; then
  case "$operation" in
    head-bucket) exit 0 ;;
    list-objects-v2)
      if [[ " $* " == *' --output text '* ]]; then
        prefix="$(value_after --prefix)"
        query="$(value_after --query)"
        if [[ "$query" == *"/database/"* ]]; then printf '%s\n' "\${FAKE_LIST_DATABASE_KEY:-None}"
        elif [[ "$prefix" == */globals/ ]]; then printf '%s\n' "\${FAKE_LIST_GLOBALS_KEY:-None}"
        elif [[ "$prefix" == */assets/ ]]; then printf '%s\n' "\${FAKE_LIST_ASSETS_KEY:-None}"
        elif [[ "$prefix" == */metadata/ ]]; then printf '%s\n' "\${FAKE_LIST_METADATA_KEY:-None}"
        elif [[ "$prefix" == */db/ ]]; then printf '%s\n' "\${FAKE_LIST_DATABASE_KEY:-None}"
        else printf 'None\n'; fi
      else
        prefix="$(value_after --prefix)"
        if [[ -n "\${FAKE_INVENTORY_JSON:-}" ]]; then
          printf '%s\n' "$FAKE_INVENTORY_JSON"
        elif [[ "$prefix" == */globals/ ]]; then
          if [[ "\${FAKE_LIST_GLOBALS_KEY:-None}" == None ]]; then printf '{\"Contents\":[]}\n'; else printf '{\"Contents\":[{\"Key\":\"%s\",\"LastModified\":\"2026-07-22T00:00:00Z\"}]}\n' "$FAKE_LIST_GLOBALS_KEY"; fi
        elif [[ "$prefix" == */assets/ ]]; then
          if [[ "\${FAKE_LIST_ASSETS_KEY:-None}" == None ]]; then printf '{\"Contents\":[]}\n'; else printf '{\"Contents\":[{\"Key\":\"%s\",\"LastModified\":\"2026-07-22T00:00:00Z\"}]}\n' "$FAKE_LIST_ASSETS_KEY"; fi
        elif [[ "$prefix" == */metadata/ ]]; then
          if [[ "\${FAKE_LIST_METADATA_KEY:-None}" == None ]]; then printf '{\"Contents\":[]}\n'; else printf '{\"Contents\":[{\"Key\":\"%s\",\"LastModified\":\"2026-07-22T00:00:00Z\"}]}\n' "$FAKE_LIST_METADATA_KEY"; fi
        elif [[ "\${FAKE_LIST_DATABASE_KEY:-None}" != None ]]; then
          printf '{\"Contents\":[{\"Key\":\"%s\",\"LastModified\":\"2026-07-22T00:00:00Z\"}]}\n' "$FAKE_LIST_DATABASE_KEY"
        else
          printf '{\"Contents\":[]}\n'
        fi
      fi
      ;;
    put-object)
      key="$(value_after --key)"; body="$(value_after --body)"; metadata="$(value_after --metadata)"
      safe="$(safe_key "$key")"; cp "$body" "$FAKE_S3_ROOT/$safe"; printf '%s' "\${metadata#sha256=}" >"$FAKE_S3_ROOT/$safe.sha"; printf 'version-placeholder\n'
      ;;
    head-object)
      key="$(value_after --key)"; safe="$(safe_key "$key")"; size="$(stat -c '%s' "$FAKE_S3_ROOT/$safe")"; sha="$(cat "$FAKE_S3_ROOT/$safe.sha")"
      [[ "\${FAKE_BAD_CHECKSUM:-0}" == 1 ]] && sha=bad
      printf '%s\t%s\n' "$size" "$sha"
      ;;
    get-object)
      key="$(value_after --key)"; safe="$(safe_key "$key")"; destination="\${args[-1]}"; cp "$FAKE_S3_ROOT/$safe" "$destination"; printf '{}\n'
      ;;
    delete-object)
      [[ "\${FAKE_DELETE_FAIL:-0}" == 1 ]] && exit 42
      key="$(value_after --key)"; safe="$(safe_key "$key")"; rm -f "$FAKE_S3_ROOT/$safe" "$FAKE_S3_ROOT/$safe.sha"; printf '{}\n'
      ;;
    get-bucket-location) printf 'ap-northeast-1\n' ;;
    get-bucket-versioning) printf 'Enabled\n' ;;
    get-bucket-acl)
      if [[ "\${FAKE_PUBLIC_ACL:-0}" == 1 ]]; then
        printf '{"Grants":[{"Grantee":{"URI":"http://acs.amazonaws.com/groups/global/AllUsers"},"Permission":"READ"}]}\n'
      else
        printf '{"Grants":[{"Grantee":{"ID":"owner-placeholder"},"Permission":"FULL_CONTROL"}]}\n'
      fi
      ;;
    get-bucket-encryption) printf 'aws:kms\n' ;;
    get-bucket-lifecycle-configuration) printf 'retention\n' ;;
    get-public-access-block) printf 'True\tTrue\tTrue\tTrue\n' ;;
    *) printf '{}\n' ;;
  esac
else
  [[ "$operation" == cp ]] || exit 1
  source="\${args[$((command_index + 2))]}"; destination="\${args[$((command_index + 3))]}"
  if [[ "$source" == s3://* ]]; then
    key="\${source#s3://*/}"
    if [[ "\${FAKE_FAIL_MANIFEST_DOWNLOAD:-0}" == 1 && "$key" == *.manifest.json ]]; then
      exit 43
    fi
    safe="$(safe_key "$key")"; cp "$FAKE_S3_ROOT/$safe" "$destination"
    if [[ "\${FAKE_CORRUPT_MANIFEST_DOWNLOAD:-0}" == 1 && "$key" == *.manifest.json ]]; then
      printf '\ncorrupted-remote-manifest\n' >>"$destination"
    fi
  else
    key="\${destination#s3://*/}"; safe="$(safe_key "$key")"; cp "$source" "$FAKE_S3_ROOT/$safe"
    metadata="$(value_after --metadata)"; printf '%s' "\${metadata#sha256=}" >"$FAKE_S3_ROOT/$safe.sha"
  fi
fi
`,
  );
  chmodSync(aws, 0o755);
  return bin;
}

function installFakeRemoteBackupTools(dir) {
  const bin = path.join(dir, "remote-bin");
  mkdirSync(bin, { recursive: true });
  const tools = {
    pg_dump: `#!/usr/bin/env bash
set -euo pipefail
args=("$@")
for i in "\${!args[@]}"; do
  if [[ "\${args[$i]}" == -f ]]; then printf 'database-placeholder\n' >"\${args[$((i + 1))]}"; exit 0; fi
done
exit 2
`,
    pg_dumpall: `#!/usr/bin/env bash
set -euo pipefail
args=("$@")
for i in "\${!args[@]}"; do
  if [[ "\${args[$i]}" == -f ]]; then printf 'globals-placeholder\n' >"\${args[$((i + 1))]}"; exit 0; fi
done
exit 2
`,
    ssh: `#!/usr/bin/env bash
set -euo pipefail
args=("$@")
index=0
while (( index < \${#args[@]} )); do
  case "\${args[$index]}" in
    -p|-i|-o) index=$((index + 2)) ;;
    -*) index=$((index + 1)) ;;
    *) break ;;
  esac
done
index=$((index + 1))
(( index < \${#args[@]} )) || exit 0
exec bash -c "\${args[$index]}"
`,
    rsync: `#!/usr/bin/env bash
set -euo pipefail
args=("$@")
operands=()
skip_next=0
for arg in "\${args[@]}"; do
  if (( skip_next == 1 )); then skip_next=0; continue; fi
  case "$arg" in
    -e) skip_next=1 ;;
    -*) ;;
    *) operands+=("$arg") ;;
  esac
done
(( \${#operands[@]} >= 2 )) || exit 2
last_index=$((\${#operands[@]} - 1))
destination="\${operands[$last_index]}"
if [[ "$destination" == *:* ]]; then
  destination="\${destination#*:}"
  mkdir -p "$destination"
  for ((i = 0; i < last_index; i += 1)); do
    cp -- "\${operands[$i]}" "$destination/"
  done
else
  mkdir -p "$destination"
  for ((i = 0; i < last_index; i += 1)); do
    source="\${operands[$i]#*:}"
    cp -- "$source" "$destination/"
  done
fi
`,
  };
  for (const [name, contents] of Object.entries(tools)) {
    const file = path.join(bin, name);
    writeFileSync(file, contents);
    chmodSync(file, 0o755);
  }
  return bin;
}

function fakeEnv(dir) {
  const bin = installFakeAws(dir);
  const store = path.join(dir, "store");
  mkdirSync(store);
  return {
    PATH: `${bin}:${process.env.PATH}`,
    FAKE_AWS_LOG: path.join(dir, "aws.log"),
    FAKE_S3_ROOT: store,
    ERP4_TMP_DIR: path.join(dir, "scratch"),
    AWS_ACCESS_KEY_ID: "sensitive-access-key-placeholder",
    AWS_SECRET_ACCESS_KEY: "sensitive-secret-key-placeholder",
  };
}

function installFakeGoogleDriveSecondary(dir, failUpload = false) {
  const script = path.join(dir, "fake-backup-gdrive-secondary.sh");
  const log = path.join(dir, "gdrive-secondary.log");
  writeFileSync(
    script,
    `#!/usr/bin/env bash
set -euo pipefail
printf '%q ' "$@" >>"$FAKE_GDRIVE_SECONDARY_LOG"
printf '\n' >>"$FAKE_GDRIVE_SECONDARY_LOG"
if [[ "\${1:-}" == upload ]]; then
  cp -- "\${3}" "$FAKE_GDRIVE_SECONDARY_LOG.request"
  if [[ "\${FAKE_GDRIVE_SECONDARY_FAIL:-0}" == 1 ]]; then
    printf '%s\n' "\${FAKE_GDRIVE_SECONDARY_ERROR:-google_drive_retryable}" >&2
    exit 42
  fi
  printf '{"status":"success","objectCount":6}\n'
fi
if [[ "\${1:-}" == check-config && "\${FAKE_GDRIVE_SECONDARY_FAIL_CONFIG:-0}" == 1 ]]; then
  printf '%s\n' "\${FAKE_GDRIVE_SECONDARY_ERROR:-google_drive_auth_expired}" >&2
  exit 43
fi
`,
  );
  chmodSync(script, 0o755);
  return {
    BACKUP_GDRIVE_CLI: script,
    FAKE_GDRIVE_SECONDARY_LOG: log,
    FAKE_GDRIVE_SECONDARY_FAIL: failUpload ? "1" : "0",
    FAKE_GDRIVE_SECONDARY_ERROR: "google_drive_retryable",
  };
}

function secondaryUploadFixture(dir, timestamp = "20260722-010203") {
  const backupDir = path.join(dir, "backups");
  mkdirSync(backupDir);
  const commit = "deadbeefcafe";
  const bundle = `erp4-${timestamp}-${commit}`;
  const database = path.join(backupDir, `${bundle}-db.dump`);
  const globals = path.join(backupDir, `${bundle}-globals.sql`);
  const metadata = path.join(backupDir, `${bundle}-meta.json`);
  writeFileSync(database, "database-placeholder");
  writeFileSync(globals, "globals-placeholder");
  writeFileSync(metadata, '{"sanitized":true}\n');
  return { backupDir, bundle, commit, database, globals };
}

function runSecondaryUploadScenario(
  dir,
  {
    failPrimary = false,
    corruptRemoteManifest = false,
    failRemoteManifestDownload = false,
    failSecondary = false,
    failSecondaryConfig = false,
    retentionClass = "daily",
    secondaryError = "google_drive_retryable",
  } = {},
) {
  const env = fakeEnv(dir);
  const gpgBin = installFakeGpg(dir);
  const secondary = installFakeGoogleDriveSecondary(dir, failSecondary);
  const fixture = secondaryUploadFixture(dir);
  const result = run("bash", ["scripts/backup-prod.sh", "upload"], {
    ...env,
    ...secondary,
    FAKE_GDRIVE_SECONDARY_ERROR: secondaryError,
    FAKE_GDRIVE_SECONDARY_FAIL_CONFIG: failSecondaryConfig ? "1" : "0",
    PATH: `${gpgBin}:${env.PATH}`,
    S3_PROVIDER: "sakura",
    S3_ENDPOINT_URL: "https://s3.example.invalid",
    S3_BUCKET: "bucket-placeholder",
    S3_PREFIX: "erp4/prod",
    S3_VERIFY_DOWNLOAD: "0",
    BACKUP_RETENTION_CLASS: retentionClass,
    BACKUP_DIR: fixture.backupDir,
    BACKUP_FILE: fixture.database,
    BACKUP_GLOBALS_FILE: fixture.globals,
    BACKUP_ID: fixture.bundle,
    COMMIT_SHA: fixture.commit,
    ENVIRONMENT: "prod",
    DB_NAME: "erp4",
    DB_VERSION: "17.5",
    SCHEMA_VERSION: "20260722000000_example",
    APP_VERSION: "1.0.0-test",
    GPG_RECIPIENT: "test-recipient",
    BACKUP_SECONDARY_PROVIDER: "gdrive",
    BACKUP_GDRIVE_CLIENT_ID: "sensitive-client-placeholder",
    BACKUP_GDRIVE_CLIENT_SECRET: "sensitive-secret-placeholder",
    BACKUP_GDRIVE_REFRESH_TOKEN: "sensitive-refresh-placeholder",
    BACKUP_GDRIVE_SHARED_DRIVE_ID: "sensitive-drive-placeholder",
    BACKUP_GDRIVE_FOLDER_ID: "sensitive-folder-placeholder",
    FAKE_BAD_CHECKSUM: failPrimary ? "1" : "0",
    FAKE_CORRUPT_MANIFEST_DOWNLOAD: corruptRemoteManifest ? "1" : "0",
    FAKE_FAIL_MANIFEST_DOWNLOAD: failRemoteManifestDownload ? "1" : "0",
  });
  return { ...fixture, ...secondary, env, result };
}

function secondaryRequestFiles(scenario) {
  if (!existsSync(scenario.env.ERP4_TMP_DIR)) return [];
  return readdirSync(scenario.env.ERP4_TMP_DIR).filter((name) =>
    name.startsWith("backup-gdrive-request."),
  );
}

test("Sakura readiness requires HTTPS endpoint and rejects unknown provider", () => {
  withScratch("backup-s3-config-", (dir) => {
    const env = fakeEnv(dir);
    const unknown = run("bash", ["scripts/check-backup-s3-readiness.sh"], {
      ...env,
      S3_PROVIDER: "unknown",
      S3_EXECUTION_MODE: "fake",
      S3_BUCKET: "bucket-placeholder",
    });
    assert.notEqual(unknown.status, 0);
    assert.match(unknown.stderr, /S3_PROVIDER must be one of/);

    const insecureAws = run("bash", ["scripts/check-backup-s3-readiness.sh"], {
      ...env,
      S3_PROVIDER: "aws",
      S3_EXECUTION_MODE: "fake",
      S3_ENDPOINT_URL: "http://aws-compatible.example.invalid",
      S3_BUCKET: "bucket-placeholder",
    });
    assert.notEqual(insecureAws.status, 0);
    assert.match(insecureAws.stderr, /credential-free HTTPS origin/);

    const noEndpoint = run("bash", ["scripts/check-backup-s3-readiness.sh"], {
      ...env,
      S3_PROVIDER: "sakura",
      S3_EXECUTION_MODE: "fake",
      S3_BUCKET: "bucket-placeholder",
    });
    assert.notEqual(noEndpoint.status, 0);
    assert.match(noEndpoint.stderr, /missing env: S3_ENDPOINT_URL/);

    const credentialEndpoint = run(
      "bash",
      ["scripts/check-backup-s3-readiness.sh"],
      {
        ...env,
        S3_PROVIDER: "sakura",
        S3_EXECUTION_MODE: "fake",
        S3_ENDPOINT_URL: "https://user:secret@s3.example.invalid",
        S3_BUCKET: "bucket-placeholder",
      },
    );
    assert.notEqual(credentialEndpoint.status, 0);
    assert.match(credentialEndpoint.stderr, /credential-free HTTPS origin/);

    const unsafePrefix = run("bash", ["scripts/check-backup-s3-readiness.sh"], {
      ...env,
      S3_PROVIDER: "sakura",
      S3_EXECUTION_MODE: "fake",
      S3_ENDPOINT_URL: "https://s3.example.invalid",
      S3_BUCKET: "bucket-placeholder",
      S3_PREFIX: "erp4/../other",
    });
    assert.notEqual(unsafePrefix.status, 0);
    assert.match(unsafePrefix.stderr, /unsafe path segment/);
  });
});

test("Sakura readiness distinguishes not_applicable checks and missing evidence", () => {
  withScratch("backup-s3-readiness-", (dir) => {
    const env = fakeEnv(dir);
    const result = run("bash", ["scripts/check-backup-s3-readiness.sh"], {
      ...env,
      S3_PROVIDER: "sakura",
      S3_EXECUTION_MODE: "fake",
      S3_ENDPOINT_URL: "https://s3.example.invalid",
      S3_BUCKET: "bucket-placeholder",
      STRICT: "0",
    });
    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    assert.match(
      result.stdout,
      /status=not_applicable reason=aws_specific_api/,
    );
    assert.match(result.stdout, /operator_evidence=missing/);
    assert.match(result.stderr, /operator evidence is missing/);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /sensitive-/);
  });
});

test("real Sakura readiness requires explicit real-run and write-probe attestations", () => {
  withScratch("backup-s3-real-attestation-", (dir) => {
    const env = fakeEnv(dir);
    const common = {
      ...env,
      S3_PROVIDER: "sakura",
      S3_EXECUTION_MODE: "real",
      S3_ENDPOINT_URL: "https://s3.example.invalid",
      S3_BUCKET: "bucket-placeholder",
    };
    const unconfirmed = run(
      "bash",
      ["scripts/check-backup-s3-readiness.sh"],
      common,
    );
    assert.notEqual(unconfirmed.status, 0);
    assert.match(unconfirmed.stderr, /S3_REAL_RUN_CONFIRM=1/);

    const noWrite = run("bash", ["scripts/check-backup-s3-readiness.sh"], {
      ...common,
      S3_REAL_RUN_CONFIRM: "1",
    });
    assert.notEqual(noWrite.status, 0);
    assert.match(noWrite.stderr, /CHECK_WRITE=1 is required/);
  });
});

test("Sakura write probe performs put, head, get and delete without KMS", () => {
  withScratch("backup-s3-write-", (dir) => {
    const env = fakeEnv(dir);
    const evidence = path.join(dir, "operator-evidence.md");
    writeFileSync(
      evidence,
      "versioningStatus=reviewed\npublicAccessStatus=reviewed\naccessControlStatus=reviewed\nretentionStatus=reviewed\n",
      { mode: 0o600 },
    );
    const result = run("bash", ["scripts/check-backup-s3-readiness.sh"], {
      ...env,
      S3_PROVIDER: "sakura",
      S3_EXECUTION_MODE: "fake",
      S3_ENDPOINT_URL: "https://s3.example.invalid",
      S3_BUCKET: "bucket-placeholder",
      S3_OPERATOR_EVIDENCE_FILE: evidence,
      CHECK_WRITE: "1",
      STRICT: "1",
    });
    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    const calls = readFileSync(env.FAKE_AWS_LOG, "utf8");
    for (const operation of [
      "get-bucket-location",
      "get-bucket-versioning",
      "get-bucket-acl",
      "put-object",
      "head-object",
      "get-object",
      "delete-object",
    ]) {
      assert.match(calls, new RegExp(operation));
    }
    assert.match(calls, /--version-id version-placeholder/);
    assert.doesNotMatch(calls, /kms|sensitive-/i);
    assert.match(result.stdout, /SUMMARY status=pass/);
    assert.doesNotMatch(
      `${result.stdout}\n${result.stderr}`,
      /bucket-placeholder|s3\.example\.invalid|sensitive-/i,
    );
  });
});

test("Sakura readiness rejects a public bucket ACL group grant", () => {
  withScratch("backup-s3-public-acl-", (dir) => {
    const env = fakeEnv(dir);
    const evidence = path.join(dir, "operator-evidence.md");
    writeFileSync(
      evidence,
      "versioningStatus=reviewed\npublicAccessStatus=reviewed\naccessControlStatus=reviewed\nretentionStatus=reviewed\n",
      { mode: 0o600 },
    );
    const result = run("bash", ["scripts/check-backup-s3-readiness.sh"], {
      ...env,
      S3_PROVIDER: "sakura",
      S3_EXECUTION_MODE: "fake",
      S3_ENDPOINT_URL: "https://s3.example.invalid",
      S3_BUCKET: "bucket-placeholder",
      S3_OPERATOR_EVIDENCE_FILE: evidence,
      FAKE_PUBLIC_ACL: "1",
      STRICT: "1",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /bucket ACL contains a public/);
  });
});

test("Sakura readiness reports operator cleanup when probe cleanup fails", () => {
  withScratch("backup-s3-cleanup-failure-", (dir) => {
    const env = fakeEnv(dir);
    const evidence = path.join(dir, "operator-evidence.md");
    writeFileSync(
      evidence,
      "versioningStatus=reviewed\npublicAccessStatus=reviewed\naccessControlStatus=reviewed\nretentionStatus=reviewed\n",
      { mode: 0o600 },
    );
    const result = run("bash", ["scripts/check-backup-s3-readiness.sh"], {
      ...env,
      S3_PROVIDER: "sakura",
      S3_EXECUTION_MODE: "fake",
      S3_ENDPOINT_URL: "https://s3.example.invalid",
      S3_BUCKET: "bucket-placeholder",
      S3_OPERATOR_EVIDENCE_FILE: evidence,
      CHECK_WRITE: "1",
      FAKE_BAD_CHECKSUM: "1",
      FAKE_DELETE_FAIL: "1",
      STRICT: "1",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /operator cleanup is required/);
  });
});

test("readiness recorder blocks fake/external evidence and rejects secret-like logs", () => {
  withScratch("backup-s3-recorder-", (dir) => {
    const log = path.join(dir, "readiness.log");
    const out = path.join(dir, "out");
    writeFileSync(
      log,
      "[backup-s3-preflight] SUMMARY status=pass warning_count=0 error_count=0 strict=1 check_write=1 provider=sakura execution_mode=fake real_run_confirm=0\n",
    );
    const recorded = run("bash", ["scripts/record-backup-s3-readiness.sh"], {
      LOG_FILE: log,
      OUT_DIR: out,
      DATE_STAMP: "2026-07-22",
      RUN_LABEL: "fake",
    });
    assert.equal(recorded.status, 0, `${recorded.stderr}\n${recorded.stdout}`);
    const report = readFileSync(
      path.join(out, "2026-07-22-backup-s3-readiness-fake.md"),
      "utf8",
    );
    assert.match(report, /summaryStatus: blocked/);
    assert.match(report, /evidenceBasis: external-sanitized-log/);

    writeFileSync(log, "Authorization: Bearer secret-placeholder\n");
    const rejected = run("bash", ["scripts/record-backup-s3-readiness.sh"], {
      LOG_FILE: log,
      OUT_DIR: out,
      DATE_STAMP: "2026-07-22",
      RUN_LABEL: "secret",
    });
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /secret-like value/);
    assert.equal(
      existsSync(path.join(out, "2026-07-22-backup-s3-readiness-secret.md")),
      false,
    );
  });
});

test("Sakura upload requires encrypted files and uploads unique manifests", () => {
  withScratch("backup-s3-upload-", (dir) => {
    const env = fakeEnv(dir);
    const gpgBin = installFakeGpg(dir);
    const encryptedEnv = { ...env, PATH: `${gpgBin}:${env.PATH}` };
    const backupDir = path.join(dir, "backups");
    mkdirSync(backupDir);
    const bundle = "erp4-20260722-010203-deadbeefcafe";
    const database = path.join(backupDir, `${bundle}-db.dump`);
    const globals = path.join(backupDir, `${bundle}-globals.sql`);
    const metadata = path.join(backupDir, `${bundle}-meta.json`);
    writeFileSync(database, "database-placeholder");
    writeFileSync(globals, "globals-placeholder");
    writeFileSync(metadata, '{"sanitized":true}\n');
    const result = run("bash", ["scripts/backup-prod.sh", "upload"], {
      ...encryptedEnv,
      S3_PROVIDER: "sakura",
      S3_ENDPOINT_URL: "https://s3.example.invalid",
      S3_BUCKET: "bucket-placeholder",
      S3_PREFIX: "erp4/prod",
      BACKUP_RETENTION_CLASS: "daily",
      S3_VERIFY_DOWNLOAD: "1",
      BACKUP_TIMESTAMP: "20260722-010203",
      BACKUP_DIR: backupDir,
      BACKUP_FILE: database,
      BACKUP_GLOBALS_FILE: globals,
      BACKUP_ID: bundle,
      COMMIT_SHA: "deadbeefcafe",
      ENVIRONMENT: "prod",
      DB_NAME: "erp4",
      DB_VERSION: "17.5",
      SCHEMA_VERSION: "20260722000000_example",
      APP_VERSION: "1.0.0-test",
      GPG_RECIPIENT: "test-recipient",
    });
    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    assert.doesNotMatch(
      `${result.stdout}\n${result.stderr}`,
      /bucket-placeholder|s3\.example\.invalid|sensitive-/i,
    );
    const calls = readFileSync(env.FAKE_AWS_LOG, "utf8");
    assert.match(
      calls,
      /erp4\/prod\/daily\/2026\/07\/erp4-20260722-010203-deadbeefcafe\/database/,
    );
    assert.match(calls, /\.manifest\.json/);
    assert.match(calls, /head-object/);
    assert.match(
      calls,
      /s3:\/\/bucket-placeholder\/.*\.manifest\.json .*backup-download-verify/,
    );
    assert.doesNotMatch(calls, /sse-kms|aws:kms|sensitive-/i);
    assert.equal(
      JSON.parse(readFileSync(`${database}.gpg.manifest.json`)).encryption
        .algorithm,
      "openpgp",
    );
    const remoteBase = `erp4/prod/daily/2026/07/${bundle}`;
    const downloadDir = path.join(dir, "downloads");
    const downloaded = run("bash", ["scripts/backup-prod.sh", "download"], {
      ...encryptedEnv,
      S3_PROVIDER: "sakura",
      S3_ENDPOINT_URL: "https://s3.example.invalid",
      S3_BUCKET: "bucket-placeholder",
      S3_PREFIX: "erp4/prod",
      BACKUP_RETENTION_CLASS: "daily",
      BACKUP_DIR: downloadDir,
      FAKE_LIST_DATABASE_KEY: `${remoteBase}/database/${path.basename(database)}.gpg`,
      FAKE_LIST_GLOBALS_KEY: `${remoteBase}/globals/${path.basename(globals)}.gpg`,
      FAKE_LIST_METADATA_KEY: `${remoteBase}/metadata/${path.basename(metadata)}.gpg`,
    });
    assert.equal(
      downloaded.status,
      0,
      `${downloaded.stderr}\n${downloaded.stdout}`,
    );
    assert.equal(
      readFileSync(path.join(downloadDir, `${path.basename(database)}.gpg`))
        .length > 0,
      true,
    );
    assert.equal(
      readFileSync(
        path.join(downloadDir, `${path.basename(database)}.gpg.manifest.json`),
      ).length > 0,
      true,
    );
    assert.match(readFileSync(env.FAKE_AWS_LOG, "utf8"), /--output json/);

    const invalidManifest = path.join(
      downloadDir,
      `${path.basename(database)}.gpg.manifest.json`,
    );
    const invalidManifestContents = JSON.parse(readFileSync(invalidManifest));
    invalidManifestContents.retentionClass = "invalid";
    writeFileSync(
      invalidManifest,
      `${JSON.stringify(invalidManifestContents, null, 2)}\n`,
    );
    const invalidManifestCheck = run(
      "bash",
      ["scripts/backup-prod.sh", "check"],
      {
        ...encryptedEnv,
        BACKUP_FILE: path.join(downloadDir, `${path.basename(database)}.gpg`),
        BACKUP_MANIFEST_FILE: invalidManifest,
      },
    );
    assert.notEqual(invalidManifestCheck.status, 0);
    assert.match(invalidManifestCheck.stderr, /manifest_invalid/);

    const missingMetadata = run(
      "bash",
      ["scripts/backup-prod.sh", "download"],
      {
        ...encryptedEnv,
        S3_PROVIDER: "sakura",
        S3_ENDPOINT_URL: "https://s3.example.invalid",
        S3_BUCKET: "bucket-placeholder",
        S3_PREFIX: "erp4/prod",
        BACKUP_RETENTION_CLASS: "daily",
        BACKUP_DIR: path.join(dir, "missing-metadata-download"),
        FAKE_LIST_DATABASE_KEY: `${remoteBase}/database/${path.basename(database)}.gpg`,
        FAKE_LIST_GLOBALS_KEY: `${remoteBase}/globals/${path.basename(globals)}.gpg`,
        FAKE_LIST_METADATA_KEY: "None",
      },
    );
    assert.notEqual(missingMetadata.status, 0);
    assert.match(missingMetadata.stderr, /matching Sakura metadata backup/);

    const failedPublishDir = path.join(dir, "failed-download");
    const mvBin = installFailingManifestMove(dir);
    const failedPublish = run("bash", ["scripts/backup-prod.sh", "download"], {
      ...encryptedEnv,
      PATH: `${mvBin}:${encryptedEnv.PATH}`,
      S3_PROVIDER: "sakura",
      S3_ENDPOINT_URL: "https://s3.example.invalid",
      S3_BUCKET: "bucket-placeholder",
      S3_PREFIX: "erp4/prod",
      BACKUP_RETENTION_CLASS: "daily",
      BACKUP_DIR: failedPublishDir,
      FAKE_LIST_DATABASE_KEY: `${remoteBase}/database/${path.basename(database)}.gpg`,
      FAKE_LIST_GLOBALS_KEY: `${remoteBase}/globals/${path.basename(globals)}.gpg`,
      FAKE_LIST_METADATA_KEY: `${remoteBase}/metadata/${path.basename(metadata)}.gpg`,
    });
    assert.notEqual(failedPublish.status, 0);
    assert.match(failedPublish.stderr, /no files were published/);
    assert.equal(
      existsSync(path.join(failedPublishDir, `${path.basename(database)}.gpg`)),
      false,
    );
    assert.equal(
      existsSync(
        path.join(
          failedPublishDir,
          `${path.basename(database)}.gpg.manifest.json`,
        ),
      ),
      false,
    );

    const staleContext = run("bash", ["scripts/backup-prod.sh", "upload"], {
      ...encryptedEnv,
      S3_PROVIDER: "sakura",
      S3_ENDPOINT_URL: "https://s3.example.invalid",
      S3_BUCKET: "bucket-placeholder",
      S3_PREFIX: "erp4/prod",
      BACKUP_RETENTION_CLASS: "weekly",
      BACKUP_DIR: backupDir,
      BACKUP_FILE: `${database}.gpg`,
      BACKUP_GLOBALS_FILE: `${globals}.gpg`,
      BACKUP_ID: bundle,
      DB_VERSION: "17.5",
      SCHEMA_VERSION: "20260722000000_example",
      APP_VERSION: "1.0.0-test",
    });
    assert.notEqual(
      staleContext.status,
      0,
      `${staleContext.stderr}\n${staleContext.stdout}`,
    );
    assert.match(staleContext.stderr, /manifest_context_mismatch/);

    const fakeBundle = "erp4-20260722-020304-cafebabefeed";
    const fakeDatabase = path.join(backupDir, `${fakeBundle}-db.dump.gpg`);
    const fakeGlobals = path.join(backupDir, `${fakeBundle}-globals.sql.gpg`);
    const fakeMetadata = path.join(backupDir, `${fakeBundle}-meta.json.gpg`);
    writeFileSync(fakeDatabase, "plain data with a misleading extension");
    writeFileSync(fakeGlobals, "plain globals with a misleading extension");
    writeFileSync(fakeMetadata, "plain metadata with a misleading extension");
    const rejected = run("bash", ["scripts/backup-prod.sh", "upload"], {
      ...env,
      S3_PROVIDER: "sakura",
      S3_ENDPOINT_URL: "https://s3.example.invalid",
      S3_BUCKET: "bucket-placeholder",
      BACKUP_DIR: backupDir,
      BACKUP_FILE: fakeDatabase,
      BACKUP_GLOBALS_FILE: fakeGlobals,
      BACKUP_ID: fakeBundle,
      COMMIT_SHA: "cafebabefeed",
      DB_VERSION: "17.5",
      SCHEMA_VERSION: "20260722000000_example",
      APP_VERSION: "1.0.0-test",
    });
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /not a valid OpenPGP message/);
  });
});

test("Google Drive secondary runs only after a verified Sakura primary bundle", () => {
  withScratch("backup-gdrive-secondary-success-", (dir) => {
    const scenario = runSecondaryUploadScenario(dir);
    assert.equal(
      scenario.result.status,
      0,
      `${scenario.result.stderr}\n${scenario.result.stdout}`,
    );
    const calls = readFileSync(scenario.FAKE_GDRIVE_SECONDARY_LOG, "utf8");
    assert.match(calls, /^check-config/m);
    assert.match(calls, /^upload --request-file /m);
    const request = JSON.parse(
      readFileSync(`${scenario.FAKE_GDRIVE_SECONDARY_LOG}.request`, "utf8"),
    );
    assert.equal(request.artifacts.length, 3);
    assert.equal(
      request.artifacts.every((file) => file.endsWith(".gpg")),
      true,
    );
    assert.doesNotMatch(
      calls,
      /sensitive-client|sensitive-secret|sensitive-refresh|sensitive-drive|sensitive-folder/,
    );
    assert.doesNotMatch(
      `${scenario.result.stdout}\n${scenario.result.stderr}`,
      /sensitive-|bucket-placeholder|s3\.example\.invalid/,
    );
    assert.deepEqual(secondaryRequestFiles(scenario), []);
    const primaryCalls = readFileSync(scenario.env.FAKE_AWS_LOG, "utf8");
    assert.equal(
      primaryCalls
        .split("\n")
        .filter(
          (line) =>
            line.includes("s3 cp s3://") && line.includes(".manifest.json"),
        ).length,
      3,
    );
  });

  for (const secondaryError of [
    "google_drive_auth_expired",
    "google_drive_quota",
    "google_drive_retryable",
    "google_drive_timeout",
  ]) {
    withScratch(`backup-gdrive-secondary-${secondaryError}-`, (dir) => {
      const scenario = runSecondaryUploadScenario(dir, {
        failSecondary: true,
        secondaryError,
      });
      assert.notEqual(scenario.result.status, 0);
      assert.match(scenario.result.stderr, new RegExp(secondaryError));
      assert.match(
        scenario.result.stderr,
        /"status":"partial_failure","primary":"success","secondary":"failed"/,
      );
      assert.match(
        readFileSync(scenario.env.FAKE_AWS_LOG, "utf8"),
        /head-object/,
      );
      assert.match(
        readFileSync(scenario.FAKE_GDRIVE_SECONDARY_LOG, "utf8"),
        /^upload --request-file /m,
      );
      assert.deepEqual(secondaryRequestFiles(scenario), []);
    });
  }

  withScratch("backup-gdrive-primary-failure-", (dir) => {
    const scenario = runSecondaryUploadScenario(dir, { failPrimary: true });
    assert.notEqual(scenario.result.status, 0);
    assert.equal(existsSync(scenario.FAKE_GDRIVE_SECONDARY_LOG), false);
    assert.doesNotMatch(scenario.result.stderr, /partial_failure/);
  });

  withScratch("backup-gdrive-primary-manifest-mismatch-", (dir) => {
    const scenario = runSecondaryUploadScenario(dir, {
      corruptRemoteManifest: true,
    });
    assert.notEqual(scenario.result.status, 0);
    assert.match(scenario.result.stderr, /remote manifest mismatch/);
    assert.equal(existsSync(scenario.FAKE_GDRIVE_SECONDARY_LOG), false);
    assert.doesNotMatch(scenario.result.stderr, /partial_failure/);
    assert.deepEqual(secondaryRequestFiles(scenario), []);
  });

  withScratch("backup-gdrive-primary-manifest-download-failure-", (dir) => {
    const scenario = runSecondaryUploadScenario(dir, {
      failRemoteManifestDownload: true,
    });
    assert.notEqual(scenario.result.status, 0);
    assert.match(scenario.result.stderr, /remote manifest download failed/);
    assert.equal(existsSync(scenario.FAKE_GDRIVE_SECONDARY_LOG), false);
    assert.doesNotMatch(scenario.result.stderr, /partial_failure/);
    assert.deepEqual(secondaryRequestFiles(scenario), []);
  });

  withScratch("backup-gdrive-hourly-skip-", (dir) => {
    const scenario = runSecondaryUploadScenario(dir, {
      retentionClass: "hourly",
    });
    assert.equal(
      scenario.result.status,
      0,
      `${scenario.result.stderr}\n${scenario.result.stdout}`,
    );
    assert.match(scenario.result.stdout, /secondary skipped for hourly/);
    assert.equal(existsSync(scenario.FAKE_GDRIVE_SECONDARY_LOG), false);
  });

  withScratch("backup-gdrive-secondary-config-failure-", (dir) => {
    const scenario = runSecondaryUploadScenario(dir, {
      failSecondaryConfig: true,
      secondaryError: "google_drive_auth_expired",
    });
    assert.notEqual(scenario.result.status, 0);
    assert.match(scenario.result.stderr, /google_drive_auth_expired/);
    assert.match(
      scenario.result.stderr,
      /"status":"partial_failure","primary":"success","secondary":"failed"/,
    );
    const secondaryCalls = readFileSync(
      scenario.FAKE_GDRIVE_SECONDARY_LOG,
      "utf8",
    );
    assert.match(secondaryCalls, /^check-config/m);
    assert.doesNotMatch(secondaryCalls, /^upload /m);
    const primaryCalls = readFileSync(scenario.env.FAKE_AWS_LOG, "utf8");
    assert.equal(
      primaryCalls
        .split("\n")
        .filter(
          (line) =>
            line.includes("s3 cp s3://") && line.includes(".manifest.json"),
        ).length,
      3,
    );
    assert.deepEqual(secondaryRequestFiles(scenario), []);
  });
});

test("Sakura accepts artifact filenames derived from a 128-character backup ID", () => {
  withScratch("backup-s3-long-name-", (dir) => {
    const env = fakeEnv(dir);
    const gpgBin = installFakeGpg(dir);
    const encryptedEnv = { ...env, PATH: `${gpgBin}:${env.PATH}` };
    const suffix = "-20260722-030405-deadbeefcafe";
    const bundle = `${"a".repeat(128 - suffix.length)}${suffix}`;
    assert.equal(bundle.length, 128);
    const database = path.join(dir, `${bundle}-db.dump`);
    const globals = path.join(dir, `${bundle}-globals.sql`);
    const metadata = path.join(dir, `${bundle}-meta.json`);
    writeFileSync(database, "database-placeholder");
    writeFileSync(globals, "globals-placeholder");
    writeFileSync(metadata, '{"sanitized":true}\n');

    const uploaded = run("bash", ["scripts/backup-prod.sh", "upload"], {
      ...encryptedEnv,
      S3_PROVIDER: "sakura",
      S3_ENDPOINT_URL: "https://s3.example.invalid",
      S3_BUCKET: "bucket-placeholder",
      S3_PREFIX: "erp4/prod",
      BACKUP_RETENTION_CLASS: "daily",
      BACKUP_FILE: database,
      BACKUP_GLOBALS_FILE: globals,
      BACKUP_ID: bundle,
      COMMIT_SHA: "deadbeefcafe",
      ENVIRONMENT: "prod",
      DB_NAME: "erp4",
      DB_VERSION: "17.5",
      SCHEMA_VERSION: "20260722000000_example",
      APP_VERSION: "1.0.0-test",
      GPG_RECIPIENT: "test-recipient",
    });
    assert.equal(uploaded.status, 0, `${uploaded.stderr}\n${uploaded.stdout}`);

    const remoteBase = `erp4/prod/daily/2026/07/${bundle}`;
    const downloadDir = path.join(dir, "downloads");
    const downloaded = run("bash", ["scripts/backup-prod.sh", "download"], {
      ...encryptedEnv,
      S3_PROVIDER: "sakura",
      S3_ENDPOINT_URL: "https://s3.example.invalid",
      S3_BUCKET: "bucket-placeholder",
      S3_PREFIX: "erp4/prod",
      BACKUP_RETENTION_CLASS: "daily",
      BACKUP_DIR: downloadDir,
      FAKE_LIST_DATABASE_KEY: `${remoteBase}/database/${path.basename(database)}.gpg`,
      FAKE_LIST_GLOBALS_KEY: `${remoteBase}/globals/${path.basename(globals)}.gpg`,
      FAKE_LIST_METADATA_KEY: `${remoteBase}/metadata/${path.basename(metadata)}.gpg`,
    });
    assert.equal(
      downloaded.status,
      0,
      `${downloaded.stderr}\n${downloaded.stdout}`,
    );
    assert.equal(
      existsSync(path.join(downloadDir, `${path.basename(database)}.gpg`)),
      true,
    );
  });
});

test("restore auto-selects encrypted artifacts and never passes gpg --yes", () => {
  withScratch("backup-s3-restore-encrypted-", (dir) => {
    const backupDir = path.join(dir, "backups");
    mkdirSync(backupDir);
    const bundle = "erp4-20260722-010203-deadbeefcafe";
    const database = path.join(backupDir, `${bundle}-db.dump.gpg`);
    const globals = path.join(backupDir, `${bundle}-globals.sql.gpg`);
    writeFileSync(database, "encrypted-database-placeholder\n");
    writeFileSync(globals, "encrypted-globals-placeholder\n");
    const restoreBin = installFakeRestoreTools(dir);
    const restoreLog = path.join(dir, "restore.log");

    const result = run("bash", ["scripts/backup-prod.sh", "restore"], {
      PATH: `${restoreBin}:${process.env.PATH}`,
      FAKE_RESTORE_LOG: restoreLog,
      BACKUP_DIR: backupDir,
      RESTORE_CONFIRM: "1",
      DB_HOST: "database.invalid",
      DB_USER: "erp4",
      DB_PASSWORD: "sensitive-password-placeholder",
      DB_NAME: "isolated_restore",
    });

    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    assert.equal(existsSync(database.slice(0, -4)), true);
    assert.equal(existsSync(globals.slice(0, -4)), true);
    const calls = readFileSync(restoreLog, "utf8");
    assert.match(calls, /gpg .*--decrypt/);
    assert.doesNotMatch(calls, /--yes/);
    assert.match(calls, /psql /);
    assert.match(calls, /pg_restore /);
    assert.doesNotMatch(
      `${result.stdout}\n${result.stderr}`,
      /sensitive-password-placeholder/,
    );
  });
});

test("restore refuses to overwrite decrypted database, globals, or assets", () => {
  for (const artifact of ["database", "globals", "assets"]) {
    withScratch(`backup-s3-restore-no-clobber-${artifact}-`, (dir) => {
      const backupDir = path.join(dir, "backups");
      mkdirSync(backupDir);
      const bundle = "erp4-20260722-010203-deadbeefcafe";
      const database = path.join(backupDir, `${bundle}-db.dump`);
      const globals = path.join(backupDir, `${bundle}-globals.sql`);
      const assets = path.join(backupDir, `${bundle}-assets.tar.gz`);
      writeFileSync(database, "database-plaintext-sentinel\n");
      writeFileSync(globals, "globals-plaintext-sentinel\n");
      writeFileSync(assets, "assets-plaintext-sentinel\n");
      writeFileSync(`${database}.gpg`, "encrypted-database-placeholder\n");
      writeFileSync(`${globals}.gpg`, "encrypted-globals-placeholder\n");
      writeFileSync(`${assets}.gpg`, "encrypted-assets-placeholder\n");
      const restoreBin = installFakeRestoreTools(dir);
      const restoreLog = path.join(dir, "restore.log");
      const env = {
        PATH: `${restoreBin}:${process.env.PATH}`,
        FAKE_RESTORE_LOG: restoreLog,
        BACKUP_DIR: backupDir,
        RESTORE_CONFIRM: "1",
        DB_HOST: "database.invalid",
        DB_USER: "erp4",
        DB_PASSWORD: "sensitive-password-placeholder",
        DB_NAME: "isolated_restore",
        BACKUP_FILE: artifact === "database" ? `${database}.gpg` : database,
        BACKUP_GLOBALS_FILE:
          artifact === "globals" ? `${globals}.gpg` : globals,
        ...(artifact === "assets"
          ? {
              SKIP_GLOBALS: "1",
              ASSET_DIR: path.join(dir, "asset-restore"),
              BACKUP_ASSETS_FILE: `${assets}.gpg`,
            }
          : {}),
      };

      const result = run("bash", ["scripts/backup-prod.sh", "restore"], env);
      assert.notEqual(result.status, 0, artifact);
      assert.match(
        result.stderr,
        new RegExp(`refusing to overwrite existing decrypted ${artifact}`),
      );
      assert.equal(
        readFileSync(
          artifact === "database"
            ? database
            : artifact === "globals"
              ? globals
              : assets,
          "utf8",
        ),
        `${artifact}-plaintext-sentinel\n`,
      );
    });
  }
});

test("AWS profile preserves custom endpoint, KMS and legacy key layout", () => {
  withScratch("backup-s3-aws-", (dir) => {
    const env = fakeEnv(dir);
    const database = path.join(dir, "erp4-20260722-010203-db.dump");
    const globals = path.join(dir, "erp4-20260722-010203-globals.sql");
    const metadata = path.join(dir, "erp4-20260722-010203-meta.json");
    writeFileSync(database, "database-placeholder");
    writeFileSync(globals, "globals-placeholder");
    writeFileSync(metadata, '{"sanitized":true}\n');
    const insecure = run("bash", ["scripts/backup-prod.sh", "upload"], {
      ...env,
      S3_PROVIDER: "aws",
      S3_ENDPOINT_URL: "http://aws-compatible.example.invalid",
      S3_BUCKET: "bucket-placeholder",
      BACKUP_DIR: dir,
      BACKUP_FILE: database,
      BACKUP_GLOBALS_FILE: globals,
      COMMIT_SHA: "deadbeefcafe",
    });
    assert.notEqual(insecure.status, 0);
    assert.match(insecure.stderr, /credential-free HTTPS origin/);

    const result = run("bash", ["scripts/backup-prod.sh", "upload"], {
      ...env,
      S3_PROVIDER: "aws",
      S3_ENDPOINT_URL: "https://aws-compatible.example.invalid",
      S3_BUCKET: "bucket-placeholder",
      S3_PREFIX: "erp4/prod",
      SSE_KMS_KEY_ID: "alias/erp4-backup",
      BACKUP_DIR: dir,
      BACKUP_FILE: database,
      BACKUP_GLOBALS_FILE: globals,
      COMMIT_SHA: "deadbeefcafe",
    });
    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    const calls = readFileSync(env.FAKE_AWS_LOG, "utf8");
    assert.match(
      calls,
      /--endpoint-url https:\/\/aws-compatible\.example\.invalid/,
    );
    assert.match(calls, /erp4\/prod\/db\/erp4-20260722-010203-db\.dump/);
    assert.match(calls, /erp4\/prod\/meta\/erp4-20260722-010203-meta\.json/);
    assert.match(calls, /--sse aws:kms --sse-kms-key-id alias\/erp4-backup/);

    const manifestFile = `${database}.manifest.json`;
    const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
    manifest.generatedAt = "2026-01-01T00:00:00.000Z";
    writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    const reusedManifest = run("bash", ["scripts/backup-prod.sh", "upload"], {
      ...env,
      S3_PROVIDER: "aws",
      S3_ENDPOINT_URL: "https://aws-compatible.example.invalid",
      S3_BUCKET: "bucket-placeholder",
      S3_PREFIX: "erp4/prod",
      SSE_KMS_KEY_ID: "alias/erp4-backup",
      BACKUP_FILE: database,
      BACKUP_GLOBALS_FILE: globals,
      COMMIT_SHA: "deadbeefcafe",
    });
    assert.equal(
      reusedManifest.status,
      0,
      `${reusedManifest.stderr}\n${reusedManifest.stdout}`,
    );
  });
});

test("remote-host backup copies and verifies artifact manifest pairs", () => {
  withScratch("backup-remote-manifest-", (dir) => {
    const bin = installFakeRemoteBackupTools(dir);
    const backupDir = path.join(dir, "backups");
    const remoteDir = path.join(dir, "remote");
    const commonEnv = {
      PATH: `${bin}:${process.env.PATH}`,
      ERP4_TMP_DIR: path.join(dir, "scratch"),
      BACKUP_PREFIX: "erp4",
      BACKUP_TIMESTAMP: "20260722-040506",
      BACKUP_RETENTION_CLASS: "daily",
      ENVIRONMENT: "prod",
      COMMIT_SHA: "deadbeefcafe",
      DB_HOST: "database.internal.invalid",
      DB_USER: "erp4",
      DB_PASSWORD: "password-placeholder",
      DB_NAME: "erp4",
      REMOTE_HOST: "backup-host.invalid",
      REMOTE_DIR: remoteDir,
    };
    const backedUp = run("bash", ["scripts/backup-prod.sh", "backup"], {
      ...commonEnv,
      BACKUP_DIR: backupDir,
    });
    assert.equal(backedUp.status, 0, `${backedUp.stderr}\n${backedUp.stdout}`);

    const bundle = "erp4-20260722-040506";
    for (const suffix of ["db.dump", "globals.sql", "meta.json"]) {
      assert.equal(
        existsSync(path.join(remoteDir, `${bundle}-${suffix}`)),
        true,
      );
      assert.equal(
        existsSync(path.join(remoteDir, `${bundle}-${suffix}.manifest.json`)),
        true,
      );
    }

    rmSync(backupDir, { recursive: true, force: true });
    const downloadDir = path.join(dir, "downloads");
    const downloaded = run("bash", ["scripts/backup-prod.sh", "download"], {
      ...commonEnv,
      BACKUP_DIR: downloadDir,
    });
    assert.equal(
      downloaded.status,
      0,
      `${downloaded.stderr}\n${downloaded.stdout}`,
    );
    for (const suffix of ["db.dump", "globals.sql", "meta.json"]) {
      assert.equal(
        existsSync(path.join(downloadDir, `${bundle}-${suffix}`)),
        true,
      );
      assert.equal(
        existsSync(path.join(downloadDir, `${bundle}-${suffix}.manifest.json`)),
        true,
      );
    }

    writeFileSync(path.join(remoteDir, `${bundle}-db.dump`), "tampered\n");
    const rejectedDir = path.join(dir, "rejected-download");
    const rejected = run("bash", ["scripts/backup-prod.sh", "download"], {
      ...commonEnv,
      BACKUP_DIR: rejectedDir,
    });
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /integrity\/context verification failed/);
    assert.equal(
      existsSync(path.join(rejectedDir, `${bundle}-db.dump`)),
      false,
    );
  });
});

test("Sakura upload rejects artifacts from different backup generations", () => {
  withScratch("backup-s3-generation-", (dir) => {
    const env = fakeEnv(dir);
    const invalidDate = "erp4-20260231-010203-deadbeefcafe";
    const invalidDateDatabase = path.join(dir, `${invalidDate}-db.dump.gpg`);
    const invalidDateGlobals = path.join(dir, `${invalidDate}-globals.sql.gpg`);
    writeFileSync(invalidDateDatabase, "placeholder");
    writeFileSync(invalidDateGlobals, "placeholder");
    const invalidDateResult = run(
      "bash",
      ["scripts/backup-prod.sh", "upload"],
      {
        ...env,
        S3_PROVIDER: "sakura",
        S3_ENDPOINT_URL: "https://s3.example.invalid",
        S3_BUCKET: "bucket-placeholder",
        BACKUP_FILE: invalidDateDatabase,
        BACKUP_GLOBALS_FILE: invalidDateGlobals,
        BACKUP_ID: invalidDate,
      },
    );
    assert.notEqual(invalidDateResult.status, 0);
    assert.match(invalidDateResult.stderr, /invalid UTC calendar timestamp/);

    const first = "erp4-20260722-010203-deadbeefcafe";
    const second = "erp4-20260722-020304-cafebabefeed";
    const database = path.join(dir, `${first}-db.dump.gpg`);
    const globals = path.join(dir, `${second}-globals.sql.gpg`);
    writeFileSync(database, "placeholder");
    writeFileSync(globals, "placeholder");
    writeFileSync(path.join(dir, `${first}-meta.json.gpg`), "placeholder");
    const result = run("bash", ["scripts/backup-prod.sh", "upload"], {
      ...env,
      S3_PROVIDER: "sakura",
      S3_ENDPOINT_URL: "https://s3.example.invalid",
      S3_BUCKET: "bucket-placeholder",
      BACKUP_FILE: database,
      BACKUP_GLOBALS_FILE: globals,
      BACKUP_ID: first,
      DB_VERSION: "17.5",
      SCHEMA_VERSION: "20260722000000_example",
      APP_VERSION: "1.0.0-test",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /same backup bundle/);
    assert.equal(existsSync(env.FAKE_AWS_LOG), false);
  });
});

test("S3 upload refuses an implicit provider profile", () => {
  withScratch("backup-s3-explicit-", (dir) => {
    const env = fakeEnv(dir);
    const database = path.join(dir, "erp4-db.dump");
    const globals = path.join(dir, "erp4-globals.sql");
    writeFileSync(database, "database-placeholder");
    writeFileSync(globals, "globals-placeholder");
    const result = run("bash", ["scripts/backup-prod.sh", "upload"], {
      ...env,
      S3_BUCKET: "bucket-placeholder",
      BACKUP_FILE: database,
      BACKUP_GLOBALS_FILE: globals,
      COMMIT_SHA: "deadbeefcafe",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /explicitly set to aws or sakura/);

    const unsafeDatabase = path.join(dir, "erp4-bad'name-db.dump");
    const unsafeGlobals = path.join(dir, "erp4-bad'name-globals.sql");
    writeFileSync(unsafeDatabase, "database-placeholder");
    writeFileSync(unsafeGlobals, "globals-placeholder");
    const unsafeName = run("bash", ["scripts/backup-prod.sh", "upload"], {
      ...env,
      S3_PROVIDER: "aws",
      S3_BUCKET: "bucket-placeholder",
      BACKUP_FILE: unsafeDatabase,
      BACKUP_GLOBALS_FILE: unsafeGlobals,
      COMMIT_SHA: "deadbeefcafe",
    });
    assert.notEqual(unsafeName.status, 0);
    assert.match(
      unsafeName.stderr,
      /BACKUP_ID contains unsupported characters/,
    );
  });
});

test("upload fails closed when remote checksum differs", () => {
  withScratch("backup-s3-checksum-", (dir) => {
    const env = fakeEnv(dir);
    const gpgBin = installFakeGpg(dir);
    const encryptedEnv = { ...env, PATH: `${gpgBin}:${env.PATH}` };
    const bundle = "erp4-20260722-010203-deadbeefcafe";
    const database = path.join(dir, `${bundle}-db.dump`);
    const globals = path.join(dir, `${bundle}-globals.sql`);
    const metadata = path.join(dir, `${bundle}-meta.json`);
    writeFileSync(database, "database");
    writeFileSync(globals, "globals");
    writeFileSync(metadata, "{}\n");
    const result = run("bash", ["scripts/backup-prod.sh", "upload"], {
      ...encryptedEnv,
      FAKE_BAD_CHECKSUM: "1",
      S3_PROVIDER: "sakura",
      S3_ENDPOINT_URL: "https://s3.example.invalid",
      S3_BUCKET: "bucket-placeholder",
      BACKUP_FILE: database,
      BACKUP_GLOBALS_FILE: globals,
      BACKUP_ID: bundle,
      COMMIT_SHA: "deadbeefcafe",
      DB_VERSION: "17.5",
      SCHEMA_VERSION: "20260722000000_example",
      APP_VERSION: "1.0.0-test",
      GPG_RECIPIENT: "test-recipient",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /remote size\/checksum mismatch/);
  });
});

function inventoryEntry(key, lastModified) {
  return { Key: key, LastModified: lastModified, Size: 10 };
}

function bundleEntries(bundle, lastModified) {
  return [
    "database/db.dump.gpg",
    "globals/globals.sql.gpg",
    "metadata/meta.json.gpg",
  ].flatMap((suffix) => [
    inventoryEntry(`erp4/prod/${bundle}/${suffix}`, lastModified),
    inventoryEntry(`erp4/prod/${bundle}/${suffix}.manifest.json`, lastModified),
  ]);
}

const TARGET_FINGERPRINT = "a".repeat(64);

function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

test("retention plan protects minimum generations and reports dry-run deletes", () => {
  withScratch("backup-retention-plan-", (dir) => {
    const inventory = path.join(dir, "inventory.json");
    const jsonOut = path.join(dir, "plan.json");
    const markdownOut = path.join(dir, "plan.md");
    writeFileSync(
      inventory,
      JSON.stringify({
        Contents: [
          ...bundleEntries(
            "hourly/2026/07/19/erp4-20260719-000000-badf00d",
            "2026-07-19T00:00:00Z",
          ),
          ...bundleEntries(
            "hourly/2026/07/22/erp4-20260722-000000-feedface",
            "2026-07-22T00:00:00Z",
          ),
          ...bundleEntries(
            "daily/2026/05/erp4-20260501-000000-deadbeef",
            "2026-05-01T00:00:00Z",
          ),
          ...bundleEntries(
            "daily/2026/07/erp4-20260721-000000-cafebabe",
            "2026-07-21T00:00:00Z",
          ),
          ...bundleEntries(
            "weekly/2026/erp4-20260101-000000-abcdef01",
            "2026-01-01T00:00:00Z",
          ),
          ...bundleEntries(
            "weekly/2026/erp4-20260721-010000-abcdef02",
            "2026-07-21T01:00:00Z",
          ),
          ...bundleEntries(
            "monthly/2025/erp4-20250101-000000-1234abcd",
            "2025-01-01T00:00:00Z",
          ),
          ...bundleEntries(
            "monthly/2026/erp4-20260721-020000-5678abcd",
            "2026-07-21T02:00:00Z",
          ),
        ],
      }),
    );
    const result = run(process.execPath, [
      "scripts/backup-s3-retention.mjs",
      "--inventory",
      inventory,
      "--prefix",
      "erp4/prod",
      "--provider",
      "sakura",
      "--target-fingerprint",
      TARGET_FINGERPRINT,
      "--now",
      "2026-07-22T00:00:00Z",
      "--min-hourly",
      "1",
      "--min-daily",
      "1",
      "--min-weekly",
      "1",
      "--min-monthly",
      "1",
      "--json-out",
      jsonOut,
      "--markdown-out",
      markdownOut,
    ]);
    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    const plan = JSON.parse(readFileSync(jsonOut));
    assert.equal(plan.applyAllowed, true);
    assert.deepEqual(plan.deleteBundles, [
      "daily/2026/05/erp4-20260501-000000-deadbeef",
      "hourly/2026/07/19/erp4-20260719-000000-badf00d",
      "monthly/2025/erp4-20250101-000000-1234abcd",
      "weekly/2026/erp4-20260101-000000-abcdef01",
    ]);
    assert.equal(plan.deleteKeys.length, 24);
    assert.deepEqual(
      Object.fromEntries(
        Object.entries(plan.classes).map(([name, value]) => [
          name,
          {
            cutoff: value.cutoff,
            deleteBundles: value.deleteBundles,
          },
        ]),
      ),
      {
        hourly: {
          cutoff: "2026-07-20T00:00:00.000Z",
          deleteBundles: 1,
        },
        daily: {
          cutoff: "2026-06-22T00:00:00.000Z",
          deleteBundles: 1,
        },
        weekly: {
          cutoff: "2026-04-29T00:00:00.000Z",
          deleteBundles: 1,
        },
        monthly: {
          cutoff: "2025-06-22T00:00:00.000Z",
          deleteBundles: 1,
        },
      },
    );
    assert.match(readFileSync(markdownOut, "utf8"), /Delete bundles: `4`/);
  });
});

test("retention plan blocks apply on orphan manifest or unsafe key", () => {
  withScratch("backup-retention-guard-", (dir) => {
    const inventory = path.join(dir, "inventory.json");
    const jsonOut = path.join(dir, "plan.json");
    const markdownOut = path.join(dir, "plan.md");
    writeFileSync(
      inventory,
      JSON.stringify({
        Contents: [
          inventoryEntry(
            "erp4/prod/daily/2025/01/erp4-20250101-000000-deadbeef/database/db.dump.gpg.manifest.json",
            "2025-01-01T00:00:00Z",
          ),
          inventoryEntry(
            "erp4/prod/daily/../escape/database/db.dump.gpg",
            "2025-01-01T00:00:00Z",
          ),
        ],
      }),
    );
    const result = run(process.execPath, [
      "scripts/backup-s3-retention.mjs",
      "--inventory",
      inventory,
      "--prefix",
      "erp4/prod",
      "--provider",
      "sakura",
      "--target-fingerprint",
      TARGET_FINGERPRINT,
      "--min-hourly",
      "1",
      "--min-daily",
      "1",
      "--min-weekly",
      "1",
      "--min-monthly",
      "1",
      "--json-out",
      jsonOut,
      "--markdown-out",
      markdownOut,
    ]);
    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    const plan = JSON.parse(readFileSync(jsonOut));
    assert.equal(plan.applyAllowed, false);
    assert.equal(plan.incompleteBundles.length, 1);
    assert.equal(plan.invalidKeys.length, 1);
  });
});

test("retention wrapper separates reviewed plan from guarded apply", () => {
  withScratch("backup-retention-wrapper-", (dir) => {
    const env = fakeEnv(dir);
    const oldBundle = "daily/2025/01/erp4-20250101-000000-deadbeef";
    const newBundle = "daily/2026/07/erp4-20260721-000000-cafebabe";
    const inventory = JSON.stringify({
      Contents: [
        ...bundleEntries(oldBundle, "2025-01-01T00:00:00Z"),
        ...bundleEntries(newBundle, "2026-07-21T00:00:00Z"),
      ],
    });
    const common = {
      ...env,
      FAKE_INVENTORY_JSON: inventory,
      S3_PROVIDER: "sakura",
      S3_ENDPOINT_URL: "https://s3.example.invalid",
      S3_BUCKET: "bucket-placeholder",
      S3_PREFIX: "erp4/prod",
      RETENTION_MIN_HOURLY: "1",
      RETENTION_MIN_DAILY: "1",
      RETENTION_MIN_WEEKLY: "1",
      RETENTION_MIN_MONTHLY: "1",
      RETENTION_NOW: "2026-07-22T00:00:00Z",
    };
    const plan = path.join(dir, "plan.json");
    const markdown = path.join(dir, "plan.md");
    const forbiddenPlan = path.join(
      ROOT,
      "docs/test-results/should-not-create-1978-retention.json",
    );
    const forbidden = run(
      "bash",
      [
        "scripts/backup-s3-retention.sh",
        "--dry-run",
        "--plan-json",
        forbiddenPlan,
        "--plan-markdown",
        path.join(dir, "forbidden-plan.md"),
      ],
      common,
    );
    assert.notEqual(forbidden.status, 0);
    assert.match(forbidden.stderr, /must stay outside docs/);
    assert.equal(existsSync(forbiddenPlan), false);

    const dryRun = run(
      "bash",
      [
        "scripts/backup-s3-retention.sh",
        "--dry-run",
        "--plan-json",
        plan,
        "--plan-markdown",
        markdown,
      ],
      common,
    );
    assert.equal(dryRun.status, 0, `${dryRun.stderr}\n${dryRun.stdout}`);
    assert.match(dryRun.stdout, /mode: dry-run/);
    assert.doesNotMatch(
      `${dryRun.stdout}\n${dryRun.stderr}`,
      /bucket-placeholder|s3\.example\.invalid|sensitive-/i,
    );
    assert.equal(JSON.parse(readFileSync(plan)).deleteKeys.length, 6);

    const noLock = run(
      "bash",
      [
        "scripts/backup-s3-retention.sh",
        "--apply",
        "--plan-json",
        plan,
        "--result-json",
        path.join(dir, "no-lock-result.json"),
      ],
      {
        ...common,
        PRUNE_CONFIRM: "1",
        RETENTION_PLAN_SHA256: sha256File(plan),
      },
    );
    assert.notEqual(noLock.status, 0);
    assert.match(noLock.stderr, /RETENTION_EXCLUSIVE_LOCK_CONFIRM=1/);

    const resultFile = path.join(dir, "result.json");
    const applied = run(
      "bash",
      [
        "scripts/backup-s3-retention.sh",
        "--apply",
        "--plan-json",
        plan,
        "--result-json",
        resultFile,
      ],
      {
        ...common,
        PRUNE_CONFIRM: "1",
        RETENTION_EXCLUSIVE_LOCK_CONFIRM: "1",
        RETENTION_PLAN_SHA256: sha256File(plan),
      },
    );
    assert.equal(applied.status, 0, `${applied.stderr}\n${applied.stdout}`);
    assert.deepEqual(JSON.parse(readFileSync(resultFile)), {
      schemaVersion: "erp4.backup.retention-result.v1",
      status: "complete",
      attemptedObjects: 6,
      deletedObjects: 6,
      planSha256: sha256File(plan),
      completedAt: JSON.parse(readFileSync(resultFile)).completedAt,
    });
    const deleteCalls = readFileSync(env.FAKE_AWS_LOG, "utf8")
      .split("\n")
      .filter((line) => line.includes("delete-object"));
    assert.equal(deleteCalls.length, 6);
    assert.equal(
      deleteCalls.slice(0, 3).every((line) => line.includes(".manifest.json")),
      true,
    );

    const tamperedPlan = path.join(dir, "tampered-plan.json");
    const tampered = JSON.parse(readFileSync(plan));
    tampered.deleteKeys.push("outside/prefix/database/unsafe.dump.gpg");
    writeFileSync(tamperedPlan, `${JSON.stringify(tampered, null, 2)}\n`, {
      mode: 0o600,
    });
    const tamperedResult = path.join(dir, "tampered-result.json");
    const rejected = run(
      "bash",
      [
        "scripts/backup-s3-retention.sh",
        "--apply",
        "--plan-json",
        tamperedPlan,
        "--result-json",
        tamperedResult,
      ],
      {
        ...common,
        PRUNE_CONFIRM: "1",
        RETENTION_EXCLUSIVE_LOCK_CONFIRM: "1",
        RETENTION_PLAN_SHA256: sha256File(tamperedPlan),
      },
    );
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /reviewed plan validation failed/);
    assert.equal(existsSync(tamperedResult), false);
  });
});
