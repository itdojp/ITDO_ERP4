#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const docsDir = path.join(rootDir, 'docs');

const imageLinkPattern = /!\[[^\]]*]\(([^)]+)\)/g;

const isExternalLink = (value) =>
  /^(https?:|data:|mailto:|tel:)/i.test(value) || value.startsWith('#');

const trimAngleBrackets = (value) => {
  if (value.startsWith('<') && value.endsWith('>')) {
    return value.slice(1, -1).trim();
  }
  return value;
};

const stripTitlePart = (value) => {
  const match = value.match(/^(\S+)/);
  return match ? match[1] : value;
};

const normalizeTarget = (raw) => {
  const cleaned = stripTitlePart(trimAngleBrackets(raw.trim()));
  return cleaned.split('#')[0].split('?')[0];
};

const toRepoRelative = (absolutePath) =>
  path.relative(rootDir, absolutePath).replace(/\\/g, '/');

const walkMarkdownFiles = (dir) => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkMarkdownFiles(fullPath));
      continue;
    }
    if (entry.isFile() && fullPath.endsWith('.md')) {
      files.push(fullPath);
    }
  }
  return files.sort();
};

const markdownFiles = walkMarkdownFiles(docsDir);
const failures = [];
let checkedCount = 0;

for (const markdownFile of markdownFiles) {
  const lines = fs.readFileSync(markdownFile, 'utf8').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.includes('![')) continue;
    imageLinkPattern.lastIndex = 0;
    let match;
    while ((match = imageLinkPattern.exec(line)) !== null) {
      const rawTarget = String(match[1] || '').trim();
      if (!rawTarget) continue;
      const target = normalizeTarget(rawTarget);
      if (!target || isExternalLink(target)) continue;
      checkedCount += 1;
      const resolvedPath = target.startsWith('/')
        ? path.join(rootDir, target.replace(/^\/+/, ''))
        : path.resolve(path.dirname(markdownFile), target);
      if (!fs.existsSync(resolvedPath)) {
        failures.push({
          file: toRepoRelative(markdownFile),
          line: index + 1,
          target,
        });
      }
    }
  }
}

if (failures.length > 0) {
  console.error(
    `[check-doc-image-links] broken image links detected: ${failures.length}`,
  );
  for (const failure of failures) {
    console.error(`- ${failure.file}:${failure.line} -> ${failure.target}`);
  }
  process.exit(1);
}

console.log(
  `[check-doc-image-links] ok (${checkedCount} image links in ${markdownFiles.length} markdown files)`,
);
