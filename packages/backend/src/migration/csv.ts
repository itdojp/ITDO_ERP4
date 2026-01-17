export function parseCsvRaw(value: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  const input = value.replace(/^\uFEFF/, '');
  for (let idx = 0; idx < input.length; idx += 1) {
    const ch = input[idx];
    if (inQuotes) {
      if (ch === '"') {
        const next = input[idx + 1];
        if (next === '"') {
          currentField += '"';
          idx += 1;
          continue;
        }
        inQuotes = false;
        continue;
      }
      currentField += ch;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      currentRow.push(currentField);
      currentField = '';
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[idx + 1] === '\n') idx += 1;
      currentRow.push(currentField);
      currentField = '';
      const isEmptyRow = currentRow.every((cell) => !cell.trim());
      if (!isEmptyRow) rows.push(currentRow);
      currentRow = [];
      continue;
    }
    currentField += ch;
  }

  currentRow.push(currentField);
  if (!currentRow.every((cell) => !cell.trim())) rows.push(currentRow);
  return rows;
}

export function normalizeCsvCell(value: string | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function parseCsvBoolean(value: string | null): boolean | undefined {
  if (value == null) return undefined;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n'].includes(normalized)) return false;
  return undefined;
}
