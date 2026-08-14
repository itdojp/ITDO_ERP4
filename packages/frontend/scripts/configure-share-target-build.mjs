import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SHARE_TARGET_MODES = new Set(['enabled', 'decommission']);

export function normalizeShareTargetMode(value) {
  const mode = String(value ?? '').trim().toLowerCase();
  if (!SHARE_TARGET_MODES.has(mode)) {
    throw new Error(
      'VITE_PWA_SHARE_TARGET_MODE must be enabled or decommission',
    );
  }
  return mode;
}

export function manifestForShareTargetMode(manifest, modeInput) {
  const mode = normalizeShareTargetMode(modeInput);
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('manifest must be an object');
  }
  const next = structuredClone(manifest);
  if (mode === 'decommission') {
    delete next.share_target;
  } else if (!next.share_target) {
    throw new Error('enabled build requires share_target');
  }
  return next;
}

export function shareTargetModeScript(modeInput) {
  const mode = normalizeShareTargetMode(modeInput);
  return `self.ERP4_SHARE_TARGET_MODE = ${JSON.stringify(mode)};\n`;
}

export function configureShareTargetBuild({ distDir, mode }) {
  const manifestPath = path.join(distDir, 'manifest.webmanifest');
  const modePath = path.join(distDir, 'share-target-mode.js');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const configured = manifestForShareTargetMode(manifest, mode);
  fs.writeFileSync(manifestPath, `${JSON.stringify(configured, null, 2)}\n`);
  fs.writeFileSync(modePath, shareTargetModeScript(mode));
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  configureShareTargetBuild({
    distDir: path.resolve(process.cwd(), 'dist'),
    mode: process.env.VITE_PWA_SHARE_TARGET_MODE,
  });
}
