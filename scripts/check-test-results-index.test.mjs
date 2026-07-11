import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  buildExpectedReadme,
  checkOrWriteIndex,
  collectTestResultsIndex,
} from "./check-test-results-index.mjs";

function makeFixture() {
  fs.mkdirSync(path.join(process.cwd(), "tmp"), { recursive: true });
  const root = fs.mkdtempSync(
    path.join(process.cwd(), "tmp", "test-results-index-"),
  );
  const resultsDir = path.join(root, "docs", "test-results");
  fs.mkdirSync(resultsDir, { recursive: true });
  fs.writeFileSync(
    path.join(resultsDir, "README.md"),
    "# テスト結果インデックス\n\n## 方針\n\n- fixture\n\n## 一覧\n\n- stale\n",
  );
  fs.writeFileSync(
    path.join(resultsDir, "2026-07-02-alpha.md"),
    "# Alpha Evidence\n",
  );
  fs.mkdirSync(path.join(resultsDir, "2026-07-02-alpha"));
  fs.writeFileSync(
    path.join(resultsDir, "2026-07-01-beta.md"),
    "# Beta Evidence\n",
  );
  fs.writeFileSync(
    path.join(resultsDir, "sample-template.md"),
    "# Sample Template\n",
  );
  fs.writeFileSync(
    path.join(resultsDir, "perf-2026-07-01.md"),
    "# Perf Evidence\n",
  );
  fs.mkdirSync(path.join(resultsDir, "perf"));
  fs.writeFileSync(
    path.join(resultsDir, "perf", "README.md"),
    "# Perf Index\n",
  );
  return root;
}

test("collectTestResultsIndex classifies regular, template, and performance entries", () => {
  const root = makeFixture();
  try {
    const index = collectTestResultsIndex(root);
    assert.deepEqual(
      index.regular.map((item) => item.path),
      [
        "docs/test-results/2026-07-02-alpha.md",
        "docs/test-results/2026-07-01-beta.md",
      ],
    );
    assert.equal(
      index.templates[0].path,
      "docs/test-results/sample-template.md",
    );
    assert.deepEqual(
      index.performance.map((item) => item.path),
      [
        "docs/test-results/perf-2026-07-01.md",
        "docs/test-results/perf/README.md",
      ],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("check fails for stale README and becomes idempotent after write", () => {
  const root = makeFixture();
  const readmePath = path.join(root, "docs", "test-results", "README.md");
  try {
    assert.throws(
      () => checkOrWriteIndex({ rootDir: root, readmePath, write: false }),
      /index is stale/,
    );
    checkOrWriteIndex({ rootDir: root, readmePath, write: true });
    assert.doesNotThrow(() =>
      checkOrWriteIndex({ rootDir: root, readmePath, write: false }),
    );
    const expected = buildExpectedReadme(root, readmePath);
    const generated = fs.readFileSync(readmePath, "utf8");
    assert.equal(generated, expected);
    assert.match(generated, /\[Alpha Evidence\]\(2026-07-02-alpha\.md\)/);
    assert.match(
      generated,
      /証跡: \[docs\/test-results\/2026-07-02-alpha\/\]\(2026-07-02-alpha\/\)/,
    );
    assert.doesNotMatch(generated, /\]\(docs\/test-results\//);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
