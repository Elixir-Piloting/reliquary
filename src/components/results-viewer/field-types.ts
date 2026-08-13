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

export function formatValueForInput(value: unknown, inputType: string): string {
  if (value === null) return '';
  const str = String(value);
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

const NUMERIC_RE = /^int|float|numeric|decimal|serial|real|double|money/;

/** Convert a raw input string ('' = null) to the JSON value sent to the backend. */
export function toSqlParamValue(raw: string | null, dataType: string): unknown {
  const val = raw === null ? '' : raw;
  if (val === '') return null;
  const dt = dataType.toLowerCase();
  if (dt === 'boolean' || dt === 'bool') return val === 'true';
  if (NUMERIC_RE.test(dt)) return Number(val);
  return val;
}
