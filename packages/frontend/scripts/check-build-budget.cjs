#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const frontendRoot = path.resolve(__dirname, '..');
const distRoot = path.join(frontendRoot, 'dist');
const assetsRoot = path.join(distRoot, 'assets');
const indexPath = path.join(distRoot, 'index.html');

const budgets = {
  maxEntryJsBytes: 100 * 1024,
  maxInitialJsBytes: 650 * 1024,
  maxInitialJsGzipBytes: 220 * 1024,
  maxIndividualJsChunkBytes: 500 * 1024,
};

function toAssetPath(assetUrl) {
  return path.join(distRoot, assetUrl.replace(/^\//, ''));
}

function sizeOf(filePath) {
  const bytes = fs.readFileSync(filePath);
  return {
    bytes: bytes.length,
    gzipBytes: zlib.gzipSync(bytes).length,
  };
}

function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

if (!fs.existsSync(indexPath)) {
  console.error(`Build output not found: ${indexPath}`);
  console.error('Run `npm run build --prefix packages/frontend` first.');
  process.exit(1);
}

const html = fs.readFileSync(indexPath, 'utf8');
const initialAssetUrls = Array.from(
  html.matchAll(/(?:src|href)="([^"]+\.js)"/g),
  (match) => match[1],
);
const uniqueInitialAssetUrls = [...new Set(initialAssetUrls)];

if (uniqueInitialAssetUrls.length === 0) {
  console.error('No initial JavaScript assets were found in dist/index.html.');
  process.exit(1);
}

if (!fs.existsSync(assetsRoot) || !fs.statSync(assetsRoot).isDirectory()) {
  console.error(`Build assets directory not found: ${assetsRoot}`);
  console.error(
    'Run a successful `npm run build --prefix packages/frontend` first.',
  );
  process.exit(1);
}

const allJsAssets = fs
  .readdirSync(assetsRoot)
  .filter((fileName) => fileName.endsWith('.js'))
  .map((fileName) => path.join(assetsRoot, fileName));

const initialAssets = uniqueInitialAssetUrls.map((assetUrl) => {
  const filePath = toAssetPath(assetUrl);
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Initial JavaScript asset referenced by index.html is missing: ${assetUrl}`,
    );
  }
  return {
    assetUrl,
    filePath,
    ...sizeOf(filePath),
  };
});

const entryAsset = initialAssets.find((asset) =>
  path.basename(asset.filePath).startsWith('index-'),
);
const initialJsBytes = initialAssets.reduce(
  (total, asset) => total + asset.bytes,
  0,
);
const initialJsGzipBytes = initialAssets.reduce(
  (total, asset) => total + asset.gzipBytes,
  0,
);
const largestJsAsset = allJsAssets
  .map((filePath) => ({ filePath, ...sizeOf(filePath) }))
  .sort((a, b) => b.bytes - a.bytes)[0];

const failures = [];

if (!entryAsset) {
  failures.push(
    'Entry JavaScript asset `index-*.js` was not found in dist/index.html.',
  );
} else if (entryAsset.bytes > budgets.maxEntryJsBytes) {
  failures.push(
    `Entry JS ${path.basename(entryAsset.filePath)} is ${formatBytes(entryAsset.bytes)}; budget is ${formatBytes(budgets.maxEntryJsBytes)}.`,
  );
}

if (initialJsBytes > budgets.maxInitialJsBytes) {
  failures.push(
    `Initial JS total is ${formatBytes(initialJsBytes)}; budget is ${formatBytes(budgets.maxInitialJsBytes)}.`,
  );
}

if (initialJsGzipBytes > budgets.maxInitialJsGzipBytes) {
  failures.push(
    `Initial JS gzip total is ${formatBytes(initialJsGzipBytes)}; budget is ${formatBytes(budgets.maxInitialJsGzipBytes)}.`,
  );
}

if (largestJsAsset?.bytes > budgets.maxIndividualJsChunkBytes) {
  failures.push(
    `Largest JS chunk ${path.basename(largestJsAsset.filePath)} is ${formatBytes(largestJsAsset.bytes)}; budget is ${formatBytes(budgets.maxIndividualJsChunkBytes)}.`,
  );
}

console.log('Frontend build budget');
console.log(
  `- Entry JS: ${entryAsset ? `${path.basename(entryAsset.filePath)} ${formatBytes(entryAsset.bytes)} / gzip ${formatBytes(entryAsset.gzipBytes)}` : 'not found'}`,
);
console.log(
  `- Initial JS total: ${formatBytes(initialJsBytes)} / gzip ${formatBytes(initialJsGzipBytes)}`,
);
console.log(
  `- Largest JS chunk: ${largestJsAsset ? `${path.basename(largestJsAsset.filePath)} ${formatBytes(largestJsAsset.bytes)} / gzip ${formatBytes(largestJsAsset.gzipBytes)}` : 'not found'}`,
);

if (failures.length > 0) {
  console.error('\nBudget check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Budget check passed.');
