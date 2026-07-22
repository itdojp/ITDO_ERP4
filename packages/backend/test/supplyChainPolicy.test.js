import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function findRepoRoot() {
  let current = process.cwd();
  for (;;) {
    if (fs.existsSync(path.join(current, '.github'))) return current;
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error('repo root not found');
    }
    current = parent;
  }
}

const repoRoot = findRepoRoot();

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function listWorkflowFiles() {
  return fs
    .readdirSync(path.join(repoRoot, '.github/workflows'))
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .map((name) => `.github/workflows/${name}`);
}

test('workflow actions used by security and release jobs are pinned to immutable SHAs', () => {
  const mutableUses = [];
  for (const relativePath of listWorkflowFiles()) {
    const content = readRepoFile(relativePath);
    for (const [index, line] of content.split('\n').entries()) {
      const match = line.match(/\buses:\s*([^@\s]+)@([^\s#]+)/);
      if (!match) continue;
      const ref = match[2];
      if (!/^[0-9a-f]{40}$/i.test(ref)) {
        mutableUses.push(`${relativePath}:${index + 1}:${match[1]}@${ref}`);
      }
    }
  }

  assert.deepEqual(mutableUses, []);
});

test('security workflow container images are pinned to digests', () => {
  const workflowImages = [];
  for (const relativePath of [
    '.github/workflows/ci.yml',
    '.github/workflows/dast-zap.yml',
    '.github/workflows/perf.yml',
  ]) {
    const content = readRepoFile(relativePath);
    for (const [index, line] of content.split('\n').entries()) {
      const serviceMatch = line.match(/\bimage:\s*([^\s#]+)/);
      const zapMatch = line.match(/\b(ghcr\.io\/zaproxy\/zaproxy:[^\s\\]+)/);
      const image = serviceMatch?.[1] || zapMatch?.[1];
      if (image)
        workflowImages.push({ path: relativePath, line: index + 1, image });
    }
  }

  const mutable = workflowImages
    .filter(({ image }) => !image.includes('@sha256:'))
    .map(({ path, line, image }) => `${path}:${line}:${image}`);
  assert.deepEqual(mutable, []);
});

test('release and SBOM workflows publish attestation subjects with checksums', () => {
  const ci = readRepoFile('.github/workflows/ci.yml');
  const release = readRepoFile('.github/workflows/release.yml');

  assert.match(
    ci,
    /sha256sum tmp\/sbom\/\*\.cdx\.json > tmp\/sbom\/SHA256SUMS/,
  );
  assert.match(ci, /actions\/attest-build-provenance@[0-9a-f]{40}/);
  assert.match(ci, /subject-checksums:\s*tmp\/sbom\/SHA256SUMS/);

  assert.match(
    release,
    /sha256sum dist\/release\/\*\.tgz dist\/release\/metadata\.json > dist\/release\/SHA256SUMS/,
  );
  assert.match(release, /actions\/attest-build-provenance@[0-9a-f]{40}/);
  assert.match(release, /subject-checksums:\s*dist\/release\/SHA256SUMS/);
});

test('Quadlet production units avoid direct app ports, latest tags, and registry auto-update', () => {
  const backend = readRepoFile('deploy/quadlet/erp4-backend.container');
  const frontend = readRepoFile('deploy/quadlet/erp4-frontend.container');
  const migrate = readRepoFile('deploy/quadlet/erp4-migrate.service');
  const caddy = readRepoFile('deploy/quadlet/erp4-caddy.container');
  const postgres = readRepoFile('deploy/quadlet/erp4-postgres.container');

  assert.doesNotMatch(backend, /PublishPort=/);
  assert.doesNotMatch(frontend, /PublishPort=/);
  assert.match(caddy, /PublishPort=0\.0\.0\.0:80:80/);
  assert.match(caddy, /PublishPort=0\.0\.0\.0:443:443/);

  for (const [name, content] of Object.entries({
    backend,
    frontend,
    migrate,
    caddy,
    postgres,
  })) {
    assert.doesNotMatch(content, /:latest\b/, `${name} uses a latest tag`);
    assert.doesNotMatch(
      content,
      /AutoUpdate=registry/,
      `${name} enables registry auto-update`,
    );
  }

  assert.match(backend, /localhost\/erp4-backend:REPLACE_WITH_COMMIT_SHA/);
  assert.match(frontend, /localhost\/erp4-frontend:REPLACE_WITH_COMMIT_SHA/);
  assert.match(migrate, /localhost\/erp4-backend:REPLACE_WITH_COMMIT_SHA/);
  assert.match(caddy, /docker\.io\/library\/caddy:2\.9-alpine@sha256:/);
  assert.match(postgres, /docker\.io\/library\/postgres:15@sha256:/);
});

test('Quadlet scripts build and install commit-derived application image tags', () => {
  const buildImages = readRepoFile('scripts/quadlet/build-images.sh');
  const installUnits = readRepoFile('scripts/quadlet/install-user-units.sh');
  const updateStack = readRepoFile('scripts/quadlet/update-stack.sh');

  assert.match(buildImages, /ERP4_IMAGE_TAG="\$\(resolve_image_tag\)"/);
  assert.match(buildImages, /localhost\/erp4-backend:\$\{ERP4_IMAGE_TAG\}/);
  assert.match(buildImages, /localhost\/erp4-frontend:\$\{ERP4_IMAGE_TAG\}/);
  assert.match(buildImages, /node:20-bookworm-slim@sha256:/);
  assert.match(buildImages, /nginx:1\.29-alpine@sha256:/);

  assert.match(
    installUnits,
    /-e "s\|REPLACE_WITH_COMMIT_SHA\|\$\{ERP4_IMAGE_TAG\}\|g"/,
  );
  assert.match(
    installUnits,
    /-e "s\|\/REPLACE_WITH_QUADLET_TARGET_DIR\|\$\{TARGET_DIR\}\|g"/,
  );
  assert.match(installUnits, /mv -fT -- "\$temp_file" "\$dst"/);
  assert.match(updateStack, /INSTALL_UNITS=/);
  assert.match(updateStack, /run_install_units/);
});
