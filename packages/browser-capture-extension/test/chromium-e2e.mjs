import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const rootDir = path.resolve(packageDir, "..", "..");
const requireFromFrontend = createRequire(
  path.join(rootDir, "packages", "frontend", "package.json"),
);
const { chromium } = requireFromFrontend("playwright");

const sourcePage = `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8">
    <title>Synthetic Capture Page</title>
    <link rel="canonical" href="/canonical-article">
    <meta name="description" content="Synthetic description">
    <meta name="author" content="Synthetic author">
    <meta property="article:published_time" content="2026-08-14T00:00:00.000Z">
    <meta name="private-canary" content="PRIVATE-METADATA-CANARY">
    <script>window.__PRIVATE_SCRIPT_CANARY__ = 'PRIVATE-SCRIPT-CANARY';</script>
  </head>
  <body>
    <h1>Synthetic Capture Page</h1>
    <p id="selection">Synthetic selected text</p>
    <form><input type="password" value="PRIVATE-PASSWORD-CANARY"></form>
  </body>
</html>`;

const landingPage = `<!doctype html>
<html lang="ja">
  <head><meta charset="utf-8"><title>ERP4 synthetic landing</title></head>
  <body>
    <h1>ERP4 synthetic landing</h1>
    <button id="receive" type="button">認証済み画面でdraftを確認</button>
    <pre id="status">未確認</pre>
    <script>
      const status = document.getElementById('status');
      const id = new URL(location.href).searchParams.get('browserCapture');
      const pendingCommands = new Map();
      const randomKey = () => {
        const bytes = crypto.getRandomValues(new Uint8Array(24));
        let binary = '';
        for (const byte of bytes) binary += String.fromCharCode(byte);
        return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
      };
      window.addEventListener('message', (event) => {
        if (event.source !== window || event.origin !== location.origin) return;
        const value = event.data;
        if (!value || value.source !== 'erp4-extension' || value.id !== id) return;
        const resolve = pendingCommands.get(value.nonce);
        if (resolve) {
          pendingCommands.delete(value.nonce);
          resolve(value.response);
        }
        if (!value.response?.ok || !value.response?.record?.draft) {
          if (value.command === 'get') status.textContent = '取得失敗';
          return;
        }
        const draft = value.response.record.draft;
        window.__ERP4_CAPTURE_LAST_DRAFT__ = draft;
        status.replaceChildren();
        for (const [label, text] of [
          ['Title', draft.title],
          ['Selection', draft.selectedText],
          ['URL', draft.url ? 'HTTP(S) URL verified' : 'Omitted'],
          ['Channel', draft.channel],
        ]) {
          const row = document.createElement('div');
          const name = document.createElement('strong');
          name.textContent = label + ': ';
          const content = document.createTextNode(text ?? 'Omitted');
          row.append(name, content);
          status.append(row);
        }
      });
      window.__ERP4_CAPTURE_SEND_COMMAND__ = (command, extras = {}) =>
        new Promise((resolve) => {
          const nonce = randomKey();
          pendingCommands.set(nonce, resolve);
          window.postMessage({
          source: 'erp4-page',
          type: 'erp4-browser-capture-command-v1',
          schemaVersion: 1,
          command,
          id,
          nonce,
          actorFingerprint: 'a'.repeat(64),
          ...extras,
          }, location.origin);
        });
      document.getElementById('receive').addEventListener('click', () => {
        void window.__ERP4_CAPTURE_SEND_COMMAND__('get');
      });
    </script>
  </body>
</html>`;

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("server unavailable");
  return address.port;
}

async function waitForExtensionTarget(cdp, extensionId) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const { targetInfos } = await cdp.send("Target.getTargets");
    const popup = targetInfos.find(
      (target) => target.url === `chrome-extension://${extensionId}/popup.html`,
    );
    if (popup) return popup;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

function targetClient(cdp, targetId) {
  let sequence = 0;
  return cdp
    .send("Target.attachToTarget", { targetId, flatten: false })
    .then(({ sessionId }) => ({
      send(method, params = {}) {
        sequence += 1;
        const id = sequence;
        return new Promise((resolve, reject) => {
          const receive = (event) => {
            if (event.sessionId !== sessionId) return;
            const message = JSON.parse(event.message);
            if (message.id !== id) return;
            cdp.off("Target.receivedMessageFromTarget", receive);
            if (message.error) reject(new Error(message.error.message));
            else resolve(message.result);
          };
          cdp.on("Target.receivedMessageFromTarget", receive);
          void cdp
            .send("Target.sendMessageToTarget", {
              sessionId,
              message: JSON.stringify({ id, method, params }),
            })
            .catch((error) => {
              cdp.off("Target.receivedMessageFromTarget", receive);
              reject(error);
            });
        });
      },
    }));
}

async function evaluateTarget(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) throw new Error("popup evaluation failed");
  return result.result?.value;
}

function invokeBrowserActionWithOsGesture() {
  const script = String.raw`
import ctypes
import ctypes.util
import time

x11 = ctypes.CDLL(ctypes.util.find_library("X11"))
xtst = ctypes.CDLL(ctypes.util.find_library("Xtst"))
x11.XOpenDisplay.restype = ctypes.c_void_p
x11.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
x11.XKeysymToKeycode.restype = ctypes.c_uint
xtst.XTestFakeKeyEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_bool, ctypes.c_ulong]
x11.XFlush.argtypes = [ctypes.c_void_p]
x11.XCloseDisplay.argtypes = [ctypes.c_void_p]
display = x11.XOpenDisplay(None)
if not display:
    raise SystemExit("X display unavailable")

keysyms = [0xffe3, 0xffe1, ord("Y")]
keycodes = [x11.XKeysymToKeycode(display, key) for key in keysyms]
for code in keycodes:
    xtst.XTestFakeKeyEvent(display, code, True, 0)
for code in reversed(keycodes):
    xtst.XTestFakeKeyEvent(display, code, False, 0)
x11.XFlush(display)
time.sleep(0.2)
x11.XCloseDisplay(display)
`;
  execFileSync("python3", ["-c", script], { stdio: "inherit" });
}

function captureDesktop(file) {
  execFileSync(
    "python3",
    [
      "-c",
      "from PIL import ImageGrab; import sys; ImageGrab.grab().save(sys.argv[1])",
      file,
    ],
    { stdio: "inherit" },
  );
}

const tempRoot = path.join(packageDir, "tmp");
mkdirSync(tempRoot, { recursive: true });
const runDir = mkdtempSync(path.join(tempRoot, "chromium-e2e-"));
const extensionDir = path.join(runDir, "extension");
const userDataDir = path.join(runDir, "profile");
const evidenceDir = process.env.ERP4_CAPTURE_EVIDENCE_DIR?.trim();
if (evidenceDir) mkdirSync(evidenceDir, { recursive: true });

const erp4Server = createServer((_request, response) => {
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(landingPage);
});
const sourceServer = createServer((_request, response) => {
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(sourcePage);
});

let context;
try {
  const erp4Port = await listen(erp4Server);
  const sourcePort = await listen(sourceServer);
  const origin = `http://127.0.0.1:${erp4Port}`;
  const sourceOrigin = `http://127.0.0.1:${sourcePort}`;
  execFileSync(
    process.execPath,
    [path.join(packageDir, "scripts", "build.mjs")],
    {
      cwd: packageDir,
      env: {
        ...process.env,
        ERP4_CAPTURE_ORIGIN: origin,
        ERP4_CAPTURE_ALLOW_INSECURE_LOCALHOST: "1",
        ERP4_CAPTURE_OUTPUT_DIR: extensionDir,
      },
      stdio: "inherit",
    },
  );

  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    executablePath: process.env.ERP4_CAPTURE_BROWSER_EXECUTABLE || undefined,
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });
  const source = context.pages()[0] || (await context.newPage());
  let serviceWorker = context.serviceWorkers()[0];
  if (!serviceWorker) {
    serviceWorker = await context
      .waitForEvent("serviceworker", { timeout: 30_000 })
      .catch(() => null);
  }
  assert.ok(serviceWorker, "unpacked extension service worker did not start");
  const extensionId = new URL(serviceWorker.url()).host;
  assert.match(extensionId, /^[a-p]{32}$/u);
  const commands = await serviceWorker.evaluate(() => chrome.commands.getAll());
  assert.equal(
    commands.find((command) => command.name === "_execute_action")?.shortcut,
    "Ctrl+Shift+Y",
  );

  await source.goto(`${sourceOrigin}/source`);
  await source.locator("#selection").selectText();
  await source.bringToFront();
  const cdp = await context.newCDPSession(source);
  invokeBrowserActionWithOsGesture();
  const popupTarget = await waitForExtensionTarget(cdp, extensionId);
  if (!popupTarget && process.env.ERP4_CAPTURE_DESKTOP_DIAGNOSTIC) {
    captureDesktop(process.env.ERP4_CAPTURE_DESKTOP_DIAGNOSTIC);
  }
  assert.ok(
    popupTarget,
    "browser action keyboard gesture did not open the extension popup",
  );
  const popup = await targetClient(cdp, popupTarget.targetId);
  const popupDeadline = Date.now() + 10_000;
  let popupText = "";
  while (Date.now() < popupDeadline) {
    popupText =
      (await evaluateTarget(
        popup,
        "document.querySelector('#fields .field') ? document.body.innerText : ''",
      )) ?? "";
    if (popupText) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(popupText, "extension popup did not render a captured draft");
  assert.match(popupText, /Synthetic Capture Page/u);
  assert.match(popupText, /Synthetic selected text/u);
  assert.doesNotMatch(
    popupText,
    /PRIVATE-(?:PASSWORD|SCRIPT|METADATA)-CANARY/u,
  );
  if (evidenceDir) {
    captureDesktop(path.join(evidenceDir, "01-extension-popup.png"));
  }

  const pageCount = context.pages().length;
  await evaluateTarget(popup, "document.getElementById('handoff').click()");
  const deadline = Date.now() + 10_000;
  let landing;
  while (Date.now() < deadline) {
    landing = context
      .pages()
      .find(
        (page) =>
          page !== source &&
          page.url().startsWith(`${origin}/?browserCapture=`),
      );
    if (landing) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(landing, `handoff page was not opened (pages before=${pageCount})`);
  const landingUrl = new URL(landing.url());
  assert.deepEqual([...landingUrl.searchParams.keys()], ["browserCapture"]);
  assert.match(
    landingUrl.searchParams.get("browserCapture") ?? "",
    /^[0-9a-f]{32}$/u,
  );

  await landing
    .getByRole("button", { name: "認証済み画面でdraftを確認" })
    .click();
  await landing.locator("#status").waitFor({ state: "visible" });
  await landing.waitForFunction(() =>
    document
      .querySelector("#status")
      ?.textContent?.includes("Synthetic selected text"),
  );

  const received = await landing.locator("#status").innerText();
  assert.match(received, /Synthetic selected text/u);
  assert.doesNotMatch(received, /PRIVATE-(?:PASSWORD|SCRIPT|METADATA)-CANARY/u);
  if (evidenceDir) {
    await landing.screenshot({
      path: path.join(evidenceDir, "02-extension-handoff.png"),
    });
  }

  // A second explicit read uses the same opaque draft and does not stage or
  // mutate a duplicate. It remains a preview-only handoff.
  await landing
    .getByRole("button", { name: "認証済み画面でdraftを確認" })
    .click();
  await landing.waitForFunction(() =>
    document
      .querySelector("#status")
      ?.textContent?.includes("Synthetic selected text"),
  );

  const operationId = "o".repeat(24);
  const pending = await landing.evaluate(
    async ({ operationId }) => {
      const draft = window.__ERP4_CAPTURE_LAST_DRAFT__;
      return window.__ERP4_CAPTURE_SEND_COMMAND__("pending", {
        operationId,
        pendingIntent: {
          selectedFields: ["title", "url", "selectedText"],
          scope: "personal",
          organizationGroupAccountIds: [],
          sourceType: "web",
        },
        draft,
      });
    },
    { operationId },
  );
  assert.equal(pending.ok, true);
  assert.equal(pending.record.lifecycle, "pending");

  const restored = await landing.evaluate(
    async ({ operationId }) =>
      window.__ERP4_CAPTURE_SEND_COMMAND__("staged", { operationId }),
    { operationId },
  );
  assert.equal(restored.ok, true);
  assert.equal(restored.record.lifecycle, "staged");

  const deleted = await landing.evaluate(async () =>
    window.__ERP4_CAPTURE_SEND_COMMAND__("delete"),
  );
  assert.equal(deleted.ok, true);
  assert.equal(deleted.record, null);
  const idempotentDelete = await landing.evaluate(async () =>
    window.__ERP4_CAPTURE_SEND_COMMAND__("delete"),
  );
  assert.equal(idempotentDelete.ok, true);
  const afterDelete = await landing.evaluate(async () =>
    window.__ERP4_CAPTURE_SEND_COMMAND__("get"),
  );
  assert.equal(afterDelete.ok, false);
  assert.equal(afterDelete.code, "not_found");

  const browserVersion = await source.evaluate(() => navigator.userAgent);
  const result = {
    schemaVersion: 1,
    browserEngine: process.env.ERP4_CAPTURE_BROWSER_EXECUTABLE
      ? "configured Chromium-compatible executable"
      : "Playwright Chromium",
    browserVersion,
    permissionSet: ["activeTab", "scripting", "storage"],
    originClass: "loopback-ephemeral",
    userGesture: "keyboard action command",
    handoff: "passed",
    sessionLifecycle: "pending-staged-delete-idempotent-delete passed",
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (evidenceDir) {
    writeFileSync(
      path.join(evidenceDir, "chromium-runtime-summary.json"),
      `${JSON.stringify(result, null, 2)}\n`,
    );
  }
} finally {
  if (context) await context.close();
  await Promise.all([
    new Promise((resolve) => erp4Server.close(resolve)),
    new Promise((resolve) => sourceServer.close(resolve)),
  ]);
  rmSync(runDir, { recursive: true, force: true });
}
