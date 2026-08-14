import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  normalizeApiConnectSource,
  renderFrontendNginxConfig,
} from './configure-frontend-security.mjs';

const packageDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const template = fs.readFileSync(
  path.resolve(
    packageDir,
    '..',
    '..',
    'deploy',
    'containers',
    'frontend.nginx.conf',
  ),
  'utf8',
);

test('renders one exact API origin into the frontend response CSP', () => {
  const rendered = renderFrontendNginxConfig(
    template,
    'https://api.example.invalid/v1',
  );
  assert.match(
    rendered,
    /connect-src 'self' https:\/\/api\.example\.invalid https:\/\/accounts\.google\.com/u,
  );
  assert.doesNotMatch(rendered, /\/v1/u);
  assert.match(
    rendered,
    /script-src 'self' https:\/\/accounts\.google\.com\/gsi\/client/u,
  );
  assert.match(
    rendered,
    /style-src 'self' 'unsafe-inline' https:\/\/accounts\.google\.com\/gsi\/style/u,
  );
  assert.match(rendered, /object-src 'none'/u);
  assert.doesNotMatch(rendered, /__ERP4_FRONTEND_CONNECT_SRC__/u);
  const locationBlock = (marker) => {
    const start = rendered.indexOf(marker);
    const end = start < 0 ? -1 : rendered.indexOf('\n  }', start);
    return start < 0 || end < 0 ? null : rendered.slice(start, end + 4);
  };
  const workerLocation = locationBlock(
    'location ~ ^/(sw|share-target-sw|share-target-mode)',
  );
  const assetLocation = locationBlock('location /assets/');
  for (const location of [workerLocation, assetLocation]) {
    assert.ok(location, 'expected bounded asset location');
    assert.match(location, /add_header Content-Security-Policy/u);
    assert.match(location, /add_header Referrer-Policy/u);
    assert.match(location, /add_header X-Content-Type-Options/u);
  }
});

test('uses same-origin API access when no API base is configured', () => {
  const rendered = renderFrontendNginxConfig(template, '');
  assert.match(rendered, /connect-src 'self' https:\/\/accounts\.google\.com/u);
});

test('rejects active, credentialed, and injected API origins', () => {
  for (const value of [
    'javascript:alert(1)',
    'https://user:password@api.example.invalid',
    'https://api.example.invalid\nscript-src https:',
  ]) {
    assert.throws(() => normalizeApiConnectSource(value));
  }
});

test('fails closed when the CSP placeholder is missing or duplicated', () => {
  assert.throws(() => renderFrontendNginxConfig('server {}', ''));
  assert.throws(() =>
    renderFrontendNginxConfig(
      '__ERP4_FRONTEND_CONNECT_SRC__ __ERP4_FRONTEND_CONNECT_SRC__',
      '',
    ),
  );
});
