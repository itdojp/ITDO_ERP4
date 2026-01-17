import crypto from 'node:crypto';

export const PO_MIGRATION_NAMESPACE_UUID =
  '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

function uuidToBytes(uuid: string): Buffer {
  const hex = uuid.replace(/-/g, '');
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) {
    throw new Error(`invalid uuid: ${uuid}`);
  }
  return Buffer.from(hex, 'hex');
}

function bytesToUuid(bytes: Buffer): string {
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

function uuidv5(name: string, namespaceUuid: string): string {
  const namespace = uuidToBytes(namespaceUuid);
  const input = Buffer.concat([namespace, Buffer.from(name, 'utf8')]);
  const hash = crypto.createHash('sha1').update(input).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return bytesToUuid(bytes);
}

export function makePoMigrationId(kind: string, legacyId: string) {
  return uuidv5(`erp4:po:${kind}:${legacyId}`, PO_MIGRATION_NAMESPACE_UUID);
}
