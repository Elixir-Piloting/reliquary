export const BUILTIN_TYPES = new Set([
  'int2','int4','int8','int','integer','smallint','bigint','serial','smallserial','bigserial',
  'float4','float8','real','float','double precision','numeric','decimal','money',
  'bool','boolean',
  'text','varchar','char','character varying','character','bpchar','name',
  'bytea',
  'date','time','timetz','timestamp','timestamptz','interval',
  'uuid','json','jsonb',
  'inet','cidr','macaddr',
  'xml','oid',
  'point','line','lseg','box','path','polygon','circle',
  'tsvector','tsquery',
]);

export function isPotentialEnum(dataType: string): boolean {
  const dt = dataType.toLowerCase();
  if (dt === 'boolean' || dt === 'bool') return false;
  if (dt.includes('date') || dt.includes('timestamp') || dt.includes('time')) return false;
  return !BUILTIN_TYPES.has(dt);
}

/** Element types for array columns reported as `_elem` by the wire protocol. */
const ARRAY_ELEMENT_BUILTINS = new Set([
  'text','varchar','character','bpchar','name',
  'int2','int4','int8','int','integer','smallint','bigint','serial','bigserial','smallserial',
  'float4','float8','real','double precision','numeric','decimal','money','oid',
  'bool','boolean','bytea',
  'date','time','timetz','timestamp','timestamptz','interval',
  'uuid','json','jsonb','inet','cidr','macaddr','xml',
]);

/**
 * True for Postgres array columns. The schema explorer reports them as
 * `text[]` (via `format_type`), while the grid/wire protocol uses the
 * pg_type name `_text` — so both spellings must be recognized.
 */
export function isArrayType(dataType: string): boolean {
  const dt = dataType.trim().toLowerCase();
  if (dt.endsWith('[]')) return true;
  if (dt.startsWith('_') && ARRAY_ELEMENT_BUILTINS.has(dt.slice(1))) return true;
  return false;
}

export function isJsonType(dataType: string): boolean {
  const dt = dataType.trim().toLowerCase();
  return dt === 'json' || dt === 'jsonb';
}

export function getInputType(dataType: string): string {
  const dt = dataType.toLowerCase();
  if (dt === 'boolean' || dt === 'bool') return 'select-boolean';
  if (isArrayType(dt)) return 'array';
  if (isJsonType(dt)) return 'json';
  if (dt.includes('date')) return 'date';
  if (dt.includes('timestamp') || dt.includes('time')) return 'datetime-local';
  if (isPotentialEnum(dt)) return 'maybe-enum';
  return 'text';
}

const NUMERIC_RE = /^(int\d?|integer|smallint|bigint|serial|bigserial|smallserial|float\d?|real|double|numeric|decimal|money|oid)\b/;
const TEXTAREA_RE = /^(text|varchar|char|character|bpchar|name|json|jsonb|xml|tsvector|tsquery|uuid|inet|cidr|macaddr|interval|bytea|point|line|lseg|box|path|polygon|circle)\b/;

/** Types edited with a numeric `<input type="number">`. */
export function isNumericType(dataType: string): boolean {
  const dt = dataType.toLowerCase();
  return NUMERIC_RE.test(dt);
}

/**
 * Types edited with a multi-line `<textarea>`: long free-form text, JSON/JSONB,
 * and any custom/unrecognized type (enums are handled by the select before this).
 */
export function isTextareaType(dataType: string): boolean {
  const dt = dataType.toLowerCase();
  if (isNumericType(dt) || dt === 'boolean' || dt === 'bool') return false;
  if (dt.includes('date') || dt.includes('timestamp') || dt.includes('time')) return false;
  if (isPotentialEnum(dt)) return true;
  return TEXTAREA_RE.test(dt);
}

export function formatValueForInput(value: unknown, inputType: string): string {
  if (value === null) return '';
  if (inputType === 'array') {
    // Wire values arrive as JS arrays; keep them as Postgres array literals
    // so the chips editor and the staged string agree.
    if (Array.isArray(value)) return arrayToPgLiteral(value);
    if (typeof value === 'string') return value;
    return String(value);
  }
  const str = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (inputType === 'date') {
    const m = str.match(/^\d{4}-\d{2}-\d{2}/);
    return m ? m[0] : str;
  }
  if (inputType === 'datetime-local') {
    const cleaned = str.replace(' ', 'T');
    return cleaned.length > 16 ? cleaned.substring(0, 16) : cleaned;
  }
  return str;
}

/** Render a cell value for display/title/copy. Pass `dataType` when known so type-specific formatting applies (e.g. a readable bytea preview instead of raw `\x` hex). */
export function displayValueToString(value: unknown, dataType?: string): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === 'object') return JSON.stringify(value);
  const str = String(value);
  // bytea arrives from the backend as `\x<hex>`; treat any such literal as a
  // blob preview regardless of the declared column type (staged text edits too).
  if (/^\\x[0-9a-fA-F]*$/.test(str) && (dataType || '').toLowerCase() === 'bytea') {
    return formatByteaPreview(str);
  }
  return str;
}

/** Readable preview of a `\x<hex>` bytea value: UTF-8 text when printable, byte count otherwise. */
function formatByteaPreview(raw: string): string {
  const hex = raw.startsWith('\\x') ? raw.slice(2) : raw;
  let sb: string[] = [];
  let printable = true;
  for (let i = 0; i + 1 < hex.length; i += 2) {
    const b = parseInt(hex.slice(i, i + 2), 16);
    const isText = b === 0x09 || b === 0x0a || b === 0x0d || (b >= 0x20 && b <= 0x7e);
    if (!isText) printable = false;
    sb.push(String.fromCharCode(b));
  }
  const byteCount = Math.floor(hex.length / 2);
  if (printable && byteCount > 0) {
    const text = sb.join('');
    const preview = text.length > 40 ? `${text.slice(0, 40)}…` : text;
    return `"${preview}" (${byteCount} B)`;
  }
  return `⟨${byteCount} B binary⟩`;
}

/** Convert a raw input string ('' = null) to the JSON value sent to the backend. */
export function toSqlParamValue(raw: string | null, dataType: string): unknown {
  const val = raw === null ? '' : raw;
  if (val === '') return null;
  const dt = dataType.toLowerCase();
  if (dt === 'boolean' || dt === 'bool') return val === 'true';
  if (isNumericType(dt)) return Number(val);
  return val;
}

// ---------------------------------------------------------------------------
// Postgres array literals (the `{a,b,"c,d"}` text format the server parses)
// ---------------------------------------------------------------------------

function escapePgArrayElement(el: unknown): string {
  const s = String(el ?? '');
  // Anything that would confuse the parser needs double-quoting (with `\` and
  // `"` backslash-escaped inside). Empty strings and NULL stay distinguishable:
  // `""` is the empty string, unquoted `NULL` is the SQL NULL element.
  if (/[\s{},"\\]/.test(s) || s === '') return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  return s;
}

/** Serialize JS values to a Postgres array literal, e.g. `["a","b c"]` → `{a,"b c"}`. */
export function arrayToPgLiteral(items: unknown[]): string {
  if (items.length === 0) return '{}';
  return `{${items.map(escapePgArrayElement).join(',')}}`;
}

/**
 * Parse a Postgres array literal into its top-level elements (1-D only).
 * Handles quoted elements, backslash escapes, and unquoted `NULL`. Returns
 * `null` when the text isn't a well-formed literal (e.g. multidimensional
 * arrays) so callers can fall back to free-text editing.
 */
export function parsePgArrayLiteral(input: string): string[] | null {
  const s = input.trim();
  if (s === '') return [];
  if (!s.startsWith('{') || !s.endsWith('}')) return null;
  const inner = s.slice(1, -1);
  if (inner.trim() === '') return [];

  const items: string[] = [];
  let buf = '';
  let inQuotes = false;
  let depth = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (inQuotes) {
      if (ch === '\\') {
        if (i + 1 < inner.length) buf += inner[i + 1];
        i++;
        continue;
      }
      if (ch === '"') { inQuotes = false; continue; }
      buf += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    // Unquoted `{`/`}` at the top level means a multidimensional array — not a
    // 1-D list the chips editor can represent — so reject it (free-text fallback).
    if ((ch === '{' || ch === '}') && depth === 0) return null;
    if (ch === '{') { depth++; buf += ch; continue; }
    if (ch === '}') { depth--; buf += ch; continue; }
    if (ch === ',' && depth === 0) { items.push(buf.trim()); buf = ''; continue; }
    buf += ch;
  }
  if (inQuotes || depth !== 0) return null;
  items.push(buf.trim());
  // A literal `NULL` element is the SQL NULL; the row editor stages list items
  // as plain strings, so map it to the empty string marker like other NULLs.
  return items.map(el => (el === 'NULL' ? '' : el));
}
