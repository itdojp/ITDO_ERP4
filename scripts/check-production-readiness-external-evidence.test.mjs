import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { evaluateExternalEvidence } from "./check-production-readiness-external-evidence.mjs";

const ROOT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const TEST_ROOT = path.join(
  ROOT_DIR,
  "tmp",
  "production-readiness-external-evidence-test",
);

function withFixture(name, fn) {
  const root = path.join(TEST_ROOT, name);
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(path.join(root, "docs", "test-results"), { recursive: true });
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function writeEvidence(root, fileName, body) {
  fs.writeFileSync(path.join(root, "docs", "test-results", fileName), body);
}

function actionPolicyEvidence({ status = "pass", checked = true } = {}) {
  return `# ActionPolicy phase3 target-environment trial 記録

- trialStatus: \`${status}\`

## #1426 completion gate

- [x] 対象環境で \`phase3_strict\` trial / cutover を実施した
- [${checked ? "x" : " "}] 主要操作確認結果を operation results file に保存した
- [x] cutover 後 fallback unique keys が 0 件であることを確認した
- [x] \`phase2_core\` rollback 手順を実施または演習し、復旧確認を保存した

## Required operation scope

- [ ] \`invoice:send\`
`;
}

function backupEvidence({ status = "pass", checked = true } = {}) {
  return `# S3 backup/restore 実証跡

- restoreStatus: \`${status}\`

## #544 / #1875 completion gate

- [x] S3 bucket / region / prefix / encryption / IAM / lifecycle / restore responsibility are finalized and match the supplied environment in the decision record
- [x] S3 readiness passed with a write/delete probe (\`CHECK_WRITE=1\`)
- [${checked ? "x" : " "}] backup -> upload -> download -> restore logs are captured
- [x] post-restore counts, amounts, references, and required files match

## Required operation scope

- [ ] backup: \`scripts/backup-prod.sh backup\`
`;
}

function csvEvidence({ status = "pass", checked = true } = {}) {
  return `# External CSV artifact intake 記録

- intakeStatus: \`${status}\`

## #1432 completion gate

- [x] manifest metadata and masking approval are complete
- [${checked ? "x" : " "}] required actual templates/samples/rule materials are received and reviewable
- [x] repo canonical samples are not used as substitutes for actual artifacts
`;
}

test("reports NO-GO when required external evidence is missing", () => {
  withFixture("missing", (root) => {
    const summary = evaluateExternalEvidence({ rootDir: root });
    assert.equal(summary.overallStatus, "NO-GO");
    assert.deepEqual(
      summary.dependencies.map((dependency) => dependency.overallStatus),
      ["MISSING", "MISSING", "MISSING"],
    );
  });
});

test("passes when all external dependency records have pass status and checked gates", () => {
  withFixture("pass", (root) => {
    writeEvidence(
      root,
      "2026-07-12-action-policy-phase3-target-trial-r1.md",
      actionPolicyEvidence(),
    );
    writeEvidence(root, "2026-07-12-backup-s3-restore-r1.md", backupEvidence());
    writeEvidence(
      root,
      "2026-07-12-external-csv-artifact-intake-r1.md",
      csvEvidence(),
    );

    const summary = evaluateExternalEvidence({ rootDir: root });
    assert.equal(summary.overallStatus, "PASS");
    assert.deepEqual(
      summary.dependencies.map((dependency) => dependency.overallStatus),
      ["PASS", "PASS", "PASS"],
    );
  });
});

test("treats pass status with unchecked completion gates as incomplete", () => {
  withFixture("unchecked", (root) => {
    writeEvidence(
      root,
      "2026-07-12-action-policy-phase3-target-trial-r1.md",
      actionPolicyEvidence({ checked: false }),
    );
    writeEvidence(root, "2026-07-12-backup-s3-restore-r1.md", backupEvidence());
    writeEvidence(
      root,
      "2026-07-12-external-csv-artifact-intake-r1.md",
      csvEvidence(),
    );

    const summary = evaluateExternalEvidence({ rootDir: root });
    assert.equal(summary.overallStatus, "NO-GO");
    assert.equal(summary.dependencies[0].overallStatus, "INCOMPLETE");
    assert.equal(summary.dependencies[0].candidates[0].uncheckedGateCount, 1);
  });
});

test("treats explicit failed status as incomplete even when gate is absent", () => {
  withFixture("failed-status", (root) => {
    writeEvidence(
      root,
      "2026-07-12-action-policy-phase3-target-trial-r1.md",
      actionPolicyEvidence({ status: "failed", checked: false }),
    );
    writeEvidence(root, "2026-07-12-backup-s3-restore-r1.md", backupEvidence());
    writeEvidence(
      root,
      "2026-07-12-external-csv-artifact-intake-r1.md",
      csvEvidence(),
    );

    const summary = evaluateExternalEvidence({ rootDir: root });
    assert.equal(summary.overallStatus, "NO-GO");
    assert.equal(summary.dependencies[0].overallStatus, "INCOMPLETE");
    assert.equal(summary.dependencies[0].statusValue, "failed");
  });
});

test("treats evidence with missing gate section as incomplete", () => {
  withFixture("no-gate", (root) => {
    writeEvidence(
      root,
      "2026-07-12-action-policy-phase3-target-trial-r1.md",
      `# Trial record
- trialStatus: \`pass\`

## Notes

No gate section.
`,
    );
    writeEvidence(root, "2026-07-12-backup-s3-restore-r1.md", backupEvidence());
    writeEvidence(
      root,
      "2026-07-12-external-csv-artifact-intake-r1.md",
      csvEvidence(),
    );

    const summary = evaluateExternalEvidence({ rootDir: root });
    assert.equal(summary.overallStatus, "NO-GO");
    assert.equal(summary.dependencies[0].overallStatus, "INCOMPLETE");
    assert.equal(summary.dependencies[0].candidates[0].gatePresent, false);
  });
});

test("requires the latest dated evidence record to pass", () => {
  withFixture("older-pass", (root) => {
    writeEvidence(
      root,
      "2026-07-14-action-policy-phase3-target-trial-r2.md",
      actionPolicyEvidence({ status: "failed", checked: false }),
    );
    writeEvidence(
      root,
      "2026-07-12-action-policy-phase3-target-trial-r1.md",
      actionPolicyEvidence(),
    );
    writeEvidence(root, "2026-07-12-backup-s3-restore-r1.md", backupEvidence());
    writeEvidence(
      root,
      "2026-07-12-external-csv-artifact-intake-r1.md",
      csvEvidence(),
    );

    const summary = evaluateExternalEvidence({ rootDir: root });
    assert.equal(summary.overallStatus, "NO-GO");
    assert.equal(summary.dependencies[0].overallStatus, "INCOMPLETE");
    assert.match(
      summary.dependencies[0].evidenceFile ?? "",
      /2026-07-14-action-policy-phase3-target-trial-r2\.md$/,
    );
    assert.equal(summary.dependencies[0].statusValue, "failed");
  });
});

test("uses numeric rN ordering for same-day evidence", () => {
  withFixture("latest-rn", (root) => {
    writeEvidence(
      root,
      "2026-07-12-action-policy-phase3-target-trial-r9.md",
      actionPolicyEvidence(),
    );
    writeEvidence(
      root,
      "2026-07-12-action-policy-phase3-target-trial-r10.md",
      actionPolicyEvidence({ status: "blocked" }),
    );
    writeEvidence(root, "2026-07-12-backup-s3-restore-r1.md", backupEvidence());
    writeEvidence(
      root,
      "2026-07-12-external-csv-artifact-intake-r1.md",
      csvEvidence(),
    );

    const summary = evaluateExternalEvidence({ rootDir: root });
    assert.equal(summary.overallStatus, "NO-GO");
    assert.equal(summary.dependencies[0].overallStatus, "INCOMPLETE");
    assert.match(
      summary.dependencies[0].evidenceFile ?? "",
      /action-policy-phase3-target-trial-r10\.md$/,
    );
    assert.equal(summary.dependencies[0].statusValue, "blocked");
  });
});

test("CLI exits non-zero for missing evidence and prints JSON details", () => {
  withFixture("cli", (root) => {
    const res = spawnSync(
      process.execPath,
      [
        path.join(
          ROOT_DIR,
          "scripts",
          "check-production-readiness-external-evidence.mjs",
        ),
        "--root-dir",
        root,
        "--json",
      ],
      { cwd: ROOT_DIR, encoding: "utf8" },
    );
    assert.equal(res.status, 1);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.overallStatus, "NO-GO");
    assert.match(res.stdout, /#1426/);
    assert.equal("fileRe" in parsed.dependencies[0], false);
  });
});

test("CLI rejects missing option values and module import is safe without argv[1]", () => {
  withFixture("cli-args", (root) => {
    const missingValue = spawnSync(
      process.execPath,
      [
        path.join(
          ROOT_DIR,
          "scripts",
          "check-production-readiness-external-evidence.mjs",
        ),
        "--root-dir",
      ],
      { cwd: ROOT_DIR, encoding: "utf8" },
    );
    assert.equal(missingValue.status, 1);
    assert.match(missingValue.stderr, /--root-dir requires a value/);

    const importOnly = spawnSync(
      process.execPath,
      [
        "-e",
        "import('./scripts/check-production-readiness-external-evidence.mjs').then(() => console.log('ok'))",
      ],
      { cwd: ROOT_DIR, encoding: "utf8" },
    );
    assert.equal(importOnly.status, 0, importOnly.stderr);
    assert.match(importOnly.stdout, /ok/);
  });
});
