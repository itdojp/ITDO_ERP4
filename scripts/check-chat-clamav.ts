import { connect, type Socket } from "node:net";

const EICAR_SIGNATURE =
  "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

type ScanVerdict = "clean" | "infected" | "error";

type ScanResult = {
  verdict: ScanVerdict;
  detected?: string;
  raw?: string;
  error?: string;
};

function resolveHost() {
  return (process.env.CLAMAV_HOST || "127.0.0.1").trim() || "127.0.0.1";
}

function resolvePort() {
  const raw = process.env.CLAMAV_PORT;
  const parsed = raw ? Number(raw) : Number.NaN;
  if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  return 3310;
}

function resolveTimeoutMs() {
  const raw = process.env.CLAMAV_TIMEOUT_MS;
  const parsed = raw ? Number(raw) : Number.NaN;
  if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  return 10000;
}

function writeAsync(socket: Socket, data: string | Buffer) {
  return new Promise<void>((resolve, reject) => {
    socket.write(data, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function scanWithClamav(buffer: Buffer): Promise<ScanResult> {
  const host = resolveHost();
  const port = resolvePort();
  const timeoutMs = resolveTimeoutMs();
  const chunkSize = 16 * 1024;

  return new Promise<ScanResult>((resolve) => {
    const socket = connect({ host, port });
    let finished = false;
    let response = "";
    const timer = setTimeout(() => {
      socket.destroy();
      finalize({ verdict: "error", error: "timeout" });
    }, timeoutMs);

    const finalize = (result: ScanResult) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      resolve(result);
    };

    socket.on("error", () =>
      finalize({ verdict: "error", error: "connect_failed" }),
    );

    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
      if (response.includes("\n") || response.includes("\0")) {
        socket.destroy();
      }
    });

    socket.on("close", () => {
      if (finished) return;
      const text = response.replace(/\0/g, "").trim();
      if (!text) {
        finalize({ verdict: "error", error: "empty_response" });
        return;
      }
      const upper = text.toUpperCase();
      if (upper.endsWith("OK")) {
        finalize({ verdict: "clean", raw: text });
        return;
      }
      if (upper.endsWith("FOUND")) {
        const detected = text
          .replace(/^[^:]*:\s*/, "")
          .replace(/\s*FOUND\s*$/i, "")
          .trim();
        finalize({
          verdict: "infected",
          detected: detected || "FOUND",
          raw: text,
        });
        return;
      }
      if (upper.endsWith("ERROR")) {
        finalize({ verdict: "error", error: "scan_error", raw: text });
        return;
      }
      finalize({ verdict: "error", error: "unknown_response", raw: text });
    });

    socket.on("connect", () => {
      void (async () => {
        try {
          await writeAsync(socket, "zINSTREAM\0");
          for (let offset = 0; offset < buffer.length; offset += chunkSize) {
            const chunk = buffer.subarray(offset, offset + chunkSize);
            const header = Buffer.alloc(4);
            header.writeUInt32BE(chunk.length, 0);
            await writeAsync(socket, header);
            await writeAsync(socket, chunk);
          }
          await writeAsync(socket, Buffer.alloc(4));
          socket.end();
        } catch {
          socket.destroy();
          finalize({ verdict: "error", error: "send_failed" });
        }
      })();
    });
  });
}

async function main() {
  const host = resolveHost();
  const port = resolvePort();
  const timeoutMs = resolveTimeoutMs();
  console.log("[clamav] host:", host);
  console.log("[clamav] port:", port);
  console.log("[clamav] timeoutMs:", timeoutMs);

  const clean = await scanWithClamav(Buffer.from("hello"));
  console.log("[clamav] clean test:", clean);
  if (clean.verdict !== "clean") {
    throw new Error("clamav_clean_test_failed");
  }

  const infected = await scanWithClamav(Buffer.from(EICAR_SIGNATURE));
  console.log("[clamav] eicar test:", infected);
  if (infected.verdict !== "infected") {
    throw new Error("clamav_eicar_test_failed");
  }

  console.log("[clamav] ok");
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("[clamav] check failed:", message);
  process.exitCode = 1;
});
