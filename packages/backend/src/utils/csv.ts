type CsvReply = {
  header: (name: string, value: string) => CsvReply;
  type: (value: string) => CsvReply;
  send: (payload: unknown) => unknown;
};

export function formatCsvValue(value: unknown) {
  if (value == null) return '';
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toCsv(headers: string[], rows: unknown[][]) {
  const lines = [headers.map(formatCsvValue).join(',')];
  for (const row of rows) {
    lines.push(row.map(formatCsvValue).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export function sendCsv(reply: CsvReply, filename: string, csv: string) {
  return reply
    .header('Content-Disposition', `attachment; filename="${filename}"`)
    .type('text/csv; charset=utf-8')
    .send(csv);
}
