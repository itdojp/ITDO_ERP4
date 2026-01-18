#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_DATABASE_URL =
  'postgresql://user:pass@localhost:5432/postgres?schema=public';

function parseArgs(argv) {
  const args = { out: 'docs/api/openapi.json' };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--out') {
      args.out = argv[i + 1];
      i += 1;
      continue;
    }
    if (value === '--help' || value === '-h') {
      args.help = true;
    }
  }
  return args;
}

function stableClone(value) {
  if (Array.isArray(value)) return value.map(stableClone);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return Object.fromEntries(entries.map(([k, v]) => [k, stableClone(v)]));
  }
  return value;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/export-openapi.mjs [--out <path>]');
    process.exit(0);
  }

  process.env.DATABASE_URL ||= DEFAULT_DATABASE_URL;
  process.env.AUTH_MODE ||= 'header';
  process.env.OPENAPI_EXPORT ||= '1';

  const serverModule = await import(
    path.resolve('packages/backend/dist/server.js')
  );
  const server = await serverModule.buildServer({ logger: false });
  await server.ready();
  const spec = server.swagger();
  await server.close();

  const payload = JSON.stringify(stableClone(spec), null, 2) + '\n';
  const outPath = path.resolve(args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, payload);
  console.log(`[openapi] wrote: ${args.out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
