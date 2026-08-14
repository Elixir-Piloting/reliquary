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

export function getInputType(dataType: string): string {
  const dt = dataType.toLowerCase();
  if (dt === 'boolean' || dt === 'bool') return 'select-boolean';
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

/** Render a cell value for display/title/copy: JSONB & arrays show their JSON text form. */
export function displayValueToString(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
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
