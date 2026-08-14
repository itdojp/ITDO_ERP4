import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const connectSourceToken = '__ERP4_FRONTEND_CONNECT_SRC__';

function parseArgs(argv) {
  const result = { template: '', out: '', apiBase: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!['--template', '--out', '--api-base'].includes(name)) {
      throw new Error('invalid frontend security configuration argument');
    }
    const value = argv[index + 1];
    if (value === undefined) {
      throw new Error('missing frontend security configuration value');
    }
    index += 1;
    if (name === '--template') result.template = value;
    if (name === '--out') result.out = value;
    if (name === '--api-base') result.apiBase = value;
  }
  if (!result.template || !result.out) {
    throw new Error('frontend security template and output are required');
  }
  return result;
}

export function normalizeApiConnectSource(value) {
  const candidate = value.trim();
  if (!candidate) return "'self'";
  if (/[^\u0021-\u007e]/u.test(candidate)) {
    throw new Error('VITE_API_BASE contains unsafe characters');
  }
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error('VITE_API_BASE must be an HTTP(S) URL');
  }
  if (
    (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error('VITE_API_BASE must be a credential-free HTTP(S) URL');
  }
  if (parsed.origin === 'null') {
    throw new Error('VITE_API_BASE must have an origin');
  }
  return `'self' ${parsed.origin}`;
}

export function renderFrontendNginxConfig(template, apiBase) {
  const occurrences = template.split(connectSourceToken).length - 1;
  if (occurrences !== 1) {
    throw new Error('frontend CSP connect source placeholder must occur once');
  }
  const rendered = template.replace(
    connectSourceToken,
    normalizeApiConnectSource(apiBase),
  );
  if (
    rendered.includes(connectSourceToken) ||
    !rendered.includes('Content-Security-Policy') ||
    !rendered.includes("script-src 'self'") ||
    !rendered.includes("object-src 'none'")
  ) {
    throw new Error('frontend CSP rendering failed closed');
  }
  return rendered;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const template = fs.readFileSync(path.resolve(args.template), 'utf8');
  const rendered = renderFrontendNginxConfig(template, args.apiBase);
  const output = path.resolve(args.out);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, rendered, { encoding: 'utf8', mode: 0o644 });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
