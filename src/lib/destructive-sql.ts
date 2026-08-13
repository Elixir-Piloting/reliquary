/**
 * The set of statement-leading keywords the backend treats as destructive
 * (mirrors `is_destructive_keyword` in `src-tauri/src/pg.rs`). Safe Mode uses
 * this to decide whether a query needs explicit confirmation before it is sent,
 * so the frontend confirmation dialog and the backend gate stay in sync.
 */
export const DESTRUCTIVE_KEYWORDS = [
  "drop",
  "delete",
  "truncate",
  "update",
  "alter",
  "create",
  "grant",
  "revoke",
  "vacuum",
  "reindex",
] as const;

const COMMENT_STRIPPERS: Array<{ regex: RegExp }> = [
  { regex: /^\s*\/\*[\s\S]*?\*\// },
  { regex: /^\s*--[^\n]*/ },
  { regex: /^\s*\/\/[^\n]*/ },
];

function firstKeyword(stmt: string): string {
  let s = stmt;
  while (true) {
    let stripped = s;
    for (const { regex } of COMMENT_STRIPPERS) {
      if (regex.test(stripped)) {
        stripped = stripped.replace(regex, "");
        break;
      }
    }
    if (stripped === s) break;
    s = stripped;
  }
  return s.trim().split(/\s+/)[0] || "";
}

/**
 * Return true if any top-level statement in `sql` (split on `;`) starts with a
 * destructive keyword. Leading comments and whitespace are tolerated; unknown
 * or empty statements are skipped. Conservative by design — on any statement we
 * cannot classify we still return true so the confirmation dialog is shown.
 */
export function isDestructiveQuery(sql: string): boolean {
  for (const stmt of sql.split(";")) {
    const kw = firstKeyword(stmt).toLowerCase();
    if (kw && (DESTRUCTIVE_KEYWORDS as readonly string[]).includes(kw)) return true;
  }
  return false;
}
