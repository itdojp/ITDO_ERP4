import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertNoForbiddenExtensionCapabilities } from "./forbidden-capabilities.mjs";

import { captureCurrentPage } from "../src/capture-page-function.js";

const packageDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const defaultOutputDir = path.join(packageDir, "dist");
const testOutputRoot = path.join(packageDir, "tmp");

function isWithin(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return (
    relative !== "" &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== ".."
  );
}

function rejectSymlinkAncestors(candidate, allowedRoot) {
  let current = candidate;
  while (current !== path.dirname(allowedRoot)) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error(
        "ERP4_CAPTURE_OUTPUT_DIR must not traverse a symbolic link",
      );
    }
    if (current === allowedRoot) return;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error("ERP4_CAPTURE_OUTPUT_DIR is outside the managed build roots");
}

export function validateOutputDirectory(raw) {
  const candidate = path.resolve(raw);
  const allowedRoot =
    candidate === defaultOutputDir
      ? defaultOutputDir
      : isWithin(candidate, testOutputRoot)
        ? testOutputRoot
        : null;
  if (!allowedRoot) {
    throw new Error(
      "ERP4_CAPTURE_OUTPUT_DIR must be the package dist directory or a child of package tmp",
    );
  }
  rejectSymlinkAncestors(candidate, allowedRoot);
  return candidate;
}

export function validateCaptureOrigin(raw, allowInsecureLocalhost = false) {
  if (typeof raw !== "string" || raw.trim() !== raw || raw.length > 2_048) {
    throw new Error("ERP4_CAPTURE_ORIGIN must be one exact origin");
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("ERP4_CAPTURE_ORIGIN must be one exact origin");
  }
  if (
    raw !== parsed.origin ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    raw.includes("*") ||
    !/^[A-Za-z0-9.:[\]-]+$/u.test(parsed.host)
  ) {
    throw new Error(
      "ERP4_CAPTURE_ORIGIN must not contain path, credentials, query, fragment, or wildcard",
    );
  }
  const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (parsed.protocol === "https:") return parsed.origin;
  if (
    parsed.protocol === "http:" &&
    allowInsecureLocalhost &&
    localHosts.has(parsed.hostname === "::1" ? "[::1]" : parsed.hostname)
  ) {
    return parsed.origin;
  }
  throw new Error(
    "ERP4_CAPTURE_ORIGIN requires HTTPS; HTTP is limited to explicit localhost test builds",
  );
}

export function buildExtension({ origin, outDir }) {
  outDir = validateOutputDirectory(outDir);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const sourceDir = path.join(packageDir, "src");
  for (const file of [
    "bridge-contract.js",
    "capture-contract.js",
    "draft-store.js",
    "service-worker.js",
    "popup.js",
    "popup.html",
    "popup.css",
  ]) {
    cpSync(path.join(sourceDir, file), path.join(outDir, file));
  }
  writeFileSync(
    path.join(outDir, "config.js"),
    `export const ERP4_CAPTURE_ORIGIN = ${JSON.stringify(origin)};\n`,
  );
  const contentScript = readFileSync(
    path.join(sourceDir, "content-script.js"),
    "utf8",
  ).replaceAll("__ERP4_CAPTURE_ORIGIN_JSON__", JSON.stringify(origin));
  writeFileSync(path.join(outDir, "content-script.js"), contentScript);
  writeFileSync(
    path.join(outDir, "capture-page.js"),
    `(${captureCurrentPage.toString()})();\n`,
  );

  const manifest = {
    manifest_version: 3,
    name: "ERP4 Browser Capture",
    version: "0.1.0",
    description: "選択したページ情報をERP4の確認画面へ安全に引き渡します。",
    minimum_chrome_version: "112",
    permissions: ["activeTab", "scripting", "storage"],
    background: {
      service_worker: "service-worker.js",
      type: "module",
    },
    action: {
      default_popup: "popup.html",
      default_title: "ERP4 Browser Capture",
    },
    commands: {
      _execute_action: {
        suggested_key: {
          default: "Ctrl+Shift+Y",
          mac: "Command+Shift+Y",
        },
        description: "ERP4 Browser Captureを開く",
      },
    },
    content_scripts: [
      {
        matches: [`${origin}/*`],
        js: ["content-script.js"],
        run_at: "document_start",
        all_frames: false,
      },
    ],
    content_security_policy: {
      extension_pages:
        "default-src 'none'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; connect-src 'none'; img-src 'none'",
    },
  };
  writeFileSync(
    path.join(outDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  const generatedJavaScript = [
    "bridge-contract.js",
    "capture-contract.js",
    "capture-page.js",
    "config.js",
    "content-script.js",
    "draft-store.js",
    "popup.js",
    "service-worker.js",
  ];
  for (const file of generatedJavaScript) {
    execFileSync(process.execPath, ["--check", path.join(outDir, file)], {
      stdio: "inherit",
    });
  }
  const generatedSource = generatedJavaScript
    .map((file) => readFileSync(path.join(outDir, file), "utf8"))
    .join("\n");
  assertNoForbiddenExtensionCapabilities(
    generatedSource,
    "generated extension",
  );
  return manifest;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const origin = validateCaptureOrigin(
    process.env.ERP4_CAPTURE_ORIGIN,
    process.env.ERP4_CAPTURE_ALLOW_INSECURE_LOCALHOST === "1",
  );
  const outDir = path.resolve(
    process.env.ERP4_CAPTURE_OUTPUT_DIR || defaultOutputDir,
  );
  buildExtension({ origin, outDir });
  process.stdout.write(`browser capture extension built for ${origin}\n`);
}
