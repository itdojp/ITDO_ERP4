import { renderStorageReadinessMarkdown } from '../application/backup/storageReadiness.js';
import { StorageReadinessConfigurationError } from '../infrastructure/backup/storageReadinessConfig.js';
import { runStorageReadiness } from './storageReadinessService.js';

type Format = 'json' | 'markdown';

export function parseStorageReadinessArgs(argv: string[]) {
  let format: Format = 'json';
  let writeProbe = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--write-probe') {
      if (writeProbe)
        throw new StorageReadinessConfigurationError(['--write-probe']);
      writeProbe = true;
    } else if (argument === '--format') {
      const value = argv[index + 1];
      if (value !== 'json' && value !== 'markdown') {
        throw new StorageReadinessConfigurationError(['--format']);
      }
      format = value;
      index += 1;
    } else {
      throw new StorageReadinessConfigurationError(['argument']);
    }
  }
  return { format, writeProbe };
}

async function main() {
  const options = parseStorageReadinessArgs(process.argv.slice(2));
  const report = await runStorageReadiness({ writeProbe: options.writeProbe });
  process.stdout.write(
    options.format === 'json'
      ? `${JSON.stringify(report, null, 2)}\n`
      : renderStorageReadinessMarkdown(report),
  );
  process.exitCode = report.overall.exitCode;
}

main().catch((error) => {
  if (error instanceof StorageReadinessConfigurationError) {
    console.error(
      '[storage-readiness][error] invalid configuration keys:',
      error.keys.join(', '),
    );
    process.exitCode = 64;
    return;
  }
  console.error('[storage-readiness][error] storage_readiness_failed');
  process.exitCode = 2;
});
