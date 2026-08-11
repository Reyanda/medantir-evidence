import { createHash } from 'node:crypto';
import { scientificContentHash } from '../core/canonical-hash.js';

export interface HistoricalJatsTableRow {
  rowIndex: number;
  cells: string[];
  rowText: string;
  sourceFragmentSha256: string;
}

export interface HistoricalJatsTable {
  label: string;
  caption: string;
  rows: HistoricalJatsTableRow[];
  tableFragmentSha256: string;
  structureHash: string;
}

function rawSha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_match, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'");
}

function xmlText(fragment: string): string {
  return decodeXmlEntities(fragment)
    .replace(/<xref\b[^>]*>([\s\S]*?)<\/xref>/gi, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstTag(fragment: string, tag: string): string {
  const match = fragment.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? xmlText(match[1] ?? '') : '';
}

function normalizedTableLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    // JATS producers vary between labels such as “Table 3” and “Table 3.”.
    // Strip terminal punctuation only; never fuzzy-match table numbers/names.
    .replace(/[\s.:;,]+$/g, '');
}

/**
 * Deterministic, intentionally narrow JATS table reader. It does not attempt to
 * render complex spans. Historical exactness is based on the raw table/row
 * fragment hashes plus the normalized cell sequence used for reconciliation.
 */
export function extractHistoricalJatsTables(xml: string): HistoricalJatsTable[] {
  if (!xml.trim()) throw new Error('Historical JATS extraction requires XML content.');
  const tables: HistoricalJatsTable[] = [];
  const tablePattern = /<table-wrap\b[^>]*>[\s\S]*?<\/table-wrap>/gi;
  for (const match of xml.matchAll(tablePattern)) {
    const fragment = match[0];
    const label = firstTag(fragment, 'label');
    const caption = firstTag(fragment, 'caption');
    const tableMatch = fragment.match(/<table\b[^>]*>([\s\S]*?)<\/table>/i);
    if (!tableMatch) continue;
    const rows: HistoricalJatsTableRow[] = [];
    const rowPattern = /<tr\b[^>]*>[\s\S]*?<\/tr>/gi;
    for (const rowMatch of (tableMatch[1] ?? '').matchAll(rowPattern)) {
      const rowFragment = rowMatch[0];
      const cells = [...rowFragment.matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)]
        .map((cell) => xmlText(cell[1] ?? ''));
      if (cells.length === 0) continue;
      rows.push({
        rowIndex: rows.length,
        cells,
        rowText: cells.join(' | '),
        sourceFragmentSha256: rawSha256(rowFragment),
      });
    }
    tables.push({
      label,
      caption,
      rows,
      tableFragmentSha256: rawSha256(fragment),
      structureHash: scientificContentHash({ label, caption, rows: rows.map((row) => row.cells) }),
    });
  }
  return tables;
}

export function requireHistoricalJatsTable(tables: HistoricalJatsTable[], label: string): HistoricalJatsTable {
  const normalized = normalizedTableLabel(label);
  const matches = tables.filter((table) => normalizedTableLabel(table.label) === normalized);
  if (matches.length !== 1) throw new Error(`Expected exactly one historical JATS table '${label}', found ${matches.length}.`);
  return matches[0]!;
}

export function findHistoricalJatsRow(
  table: HistoricalJatsTable,
  rowLabel: string,
): HistoricalJatsTableRow {
  const needle = rowLabel.trim().toLowerCase();
  const matches = table.rows.filter((row) => row.cells[0]?.toLowerCase().includes(needle));
  if (matches.length !== 1) throw new Error(`Expected exactly one row matching '${rowLabel}' in ${table.label}, found ${matches.length}.`);
  return matches[0]!;
}
