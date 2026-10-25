import ExcelJS from 'exceljs';

/** Read an uploaded XLSX or CSV into rows of trimmed strings (first row = headers). */
export async function readTable(bytes: Uint8Array, mime: string): Promise<string[][]> {
  if (mime === 'text/csv') return parseCsv(new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, ''));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(bytes) as never);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const rows: string[][] = [];
  const width = ws.columnCount;
  ws.eachRow({ includeEmpty: false }, (row) => {
    const out: string[] = [];
    for (let c = 1; c <= width; c++) out.push(cellText(row.getCell(c).value));
    rows.push(out);
  });
  return rows;
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue);
    if ('richText' in v) return v.richText.map((r) => r.text).join('').trim();
    if ('text' in v) return String(v.text).trim();
    if ('hyperlink' in v) return String((v as { hyperlink: string }).hyperlink);
    return '';
  }
  return String(v).trim();
}

/** RFC 4180 CSV with quoted fields; accepts comma or semicolon separators. */
export function parseCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      row.push(field.trim());
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field.trim());
      field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field.trim());
  if (row.some((f) => f !== '')) rows.push(row);
  return rows;
}

/** Build an XLSX sheet (templates and error reports). */
export async function writeTable(sheetName: string, header: string[], rows: (string | number | null)[][], note?: string): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  ws.addRow(header).font = { bold: true };
  for (const r of rows) ws.addRow(r);
  ws.columns.forEach((c) => (c.width = 22));
  if (note) {
    const info = wb.addWorksheet('Hướng dẫn');
    for (const line of note.split('\n')) info.addRow([line]);
    info.getColumn(1).width = 110;
  }
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
