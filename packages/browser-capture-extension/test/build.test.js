import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildExtension,
  validateCaptureOrigin,
  validateOutputDirectory,
} from "../scripts/build.mjs";

test("accepts one HTTPS origin and explicit local HTTP only", () => {
  assert.equal(
    validateCaptureOrigin("https://erp4.example.invalid"),
    "https://erp4.example.invalid",
  );
  assert.equal(
    validateCaptureOrigin("http://127.0.0.1:5173", true),
    "http://127.0.0.1:5173",
  );
  for (const value of [
    "http://erp4.example.invalid",
    "https://erp4.example.invalid/",
    "https://user:password@erp4.example.invalid",
    "https://erp4.example.invalid/path",
    "https://erp4.example.invalid?query=1",
    "https://erp4.example.invalid/#fragment",
    "https://*.example.invalid",
    'https://x";alert(document.cookie);"x.invalid',
  ]) {
    assert.throws(() => validateCaptureOrigin(value), /ERP4_CAPTURE_ORIGIN/u);
  }
});

test("generates a bounded MV3 manifest for the exact ERP4 origin", () => {
  const tempRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "tmp",
    "build-test",
  );
  mkdirSync(tempRoot, { recursive: true });
  const outDir = mkdtempSync(path.join(tempRoot, "fixture-"));
  try {
    const manifest = buildExtension({
      origin: "https://erp4.example.invalid",
      outDir,
    });
    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.minimum_chrome_version, "112");
    assert.deepEqual(manifest.permissions, [
      "activeTab",
      "scripting",
      "storage",
    ]);
    assert.deepEqual(manifest.content_scripts[0].matches, [
      "https://erp4.example.invalid/*",
    ]);
    assert.equal(manifest.content_scripts[0].all_frames, false);
    for (const forbidden of [
      "<all_urls>",
      "cookies",
      "tabs",
      "history",
      "webRequest",
      "webRequestBlocking",
      "downloads",
      "clipboardRead",
      "nativeMessaging",
      "management",
      "debugger",
    ]) {
      assert.equal(manifest.permissions.includes(forbidden), false, forbidden);
    }
    assert.equal("host_permissions" in manifest, false);
    assert.equal("externally_connectable" in manifest, false);
    assert.equal("web_accessible_resources" in manifest, false);
    assert.match(
      manifest.content_security_policy.extension_pages,
      /^default-src 'none'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; connect-src 'none'; img-src 'none'$/u,
    );
    const content = readFileSync(
      path.join(outDir, "content-script.js"),
      "utf8",
    );
    assert.match(content, /https:\/\/erp4\.example\.invalid/u);
    assert.doesNotMatch(content, /__ERP4_CAPTURE_ORIGIN__/u);
    assert.doesNotMatch(content, /document\.cookie/u);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("freezes popup capture inputs while a stage outcome is unknown", () => {
  const packageRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const popup = readFileSync(path.join(packageRoot, "src", "popup.js"), "utf8");
  assert.match(
    popup,
    /state\.isStaging \|\| state\.stageIntent !== null \|\| state\.stagedId\.length > 0/u,
  );
  assert.match(popup, /checkbox\.disabled = inputsLocked \|\| value === null/u);
  assert.match(popup, /recapture\.disabled = inputsLocked/u);
  assert.match(
    popup,
    /if \(captureInputsLocked\(\)\) throw new Error\("capture_locked"\)/u,
  );
  assert.match(
    popup,
    /if \(captureInputsLocked\(\)\) \{[\s\S]*checkbox\.checked = state\.selectedFields\.includes\(field\)/u,
  );
  assert.match(
    popup,
    /state\.isStaging = true;[\s\S]*finally \{[\s\S]*state\.isStaging = false/u,
  );
  assert.match(
    popup,
    /if \(response\?\.ok === false\) state\.stageIntent = null/u,
  );
});

test("refuses recursive cleanup outside managed output roots or through symlinks", () => {
  const packageRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const testRoot = path.join(packageRoot, "tmp", "output-guard-test");
  const target = path.join(testRoot, "target");
  const link = path.join(testRoot, "link");
  mkdirSync(target, { recursive: true });
  symlinkSync(target, link, "dir");
  try {
    for (const unsafe of [
      packageRoot,
      path.join(packageRoot, "dist", "child"),
      path.join(packageRoot, "tmp"),
      path.join(link, "output"),
    ]) {
      assert.throws(
        () => validateOutputDirectory(unsafe),
        /ERP4_CAPTURE_OUTPUT_DIR/u,
        unsafe,
      );
    }
  } finally {
    rmSync(testRoot, { recursive: true, force: true });
  }
});
