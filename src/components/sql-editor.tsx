"use client";
import { useRef, useState, useEffect } from "react";
import Editor from "@monaco-editor/react";
import type { editor } from "monaco-editor";

interface SQLEditorProps {
  value: string;
  onChange: (value: string) => void;
  onExecute: () => void;
  disabled?: boolean;
  language?: "sql" | "javascript";
  connectionId?: string;
  schemas?: string[];
  getTables?: (schema: string) => Promise<string[]>;
  getColumns?: (schema: string, table: string) => Promise<string[]>;
}

/**
 * Schema-aware completion for the SQL language.
 *
 * Design notes / limitations:
 * - The provider is registered ONCE per monaco instance (guarded by `providersRegistered`)
 *   and reads the current editor props through the mutable module-level `activeCtx`.
 *   This avoids duplicate providers on re-mount / React StrictMode while keeping the
 *   closure fresh on every render.
 * - Table / column names are cached per connection (load-once). Concurrent completion
 *   requests for the same key share the same in-flight promise.
 * - Table detection for column suggestions is heuristic: we scan the whole query text
 *   for `FROM|JOIN|UPDATE|INTO|TABLE|REFERENCES <schema>.<table>` patterns and offer
 *   the columns of those tables. It is NOT a real SQL parser — aliases, subqueries and
 *   CTEs will not be resolved.
 */

const SQL_KEYWORDS = [
  "SELECT", "FROM", "WHERE", "JOIN", "INSERT", "UPDATE", "DELETE", "CREATE", "DROP", "ALTER",
  "TABLE", "INTO", "VALUES", "SET", "AND", "OR", "NOT", "NULL", "ORDER", "BY", "GROUP", "HAVING",
  "LIMIT", "OFFSET", "ASC", "DESC", "IN", "EXISTS", "AS", "ON", "LEFT", "RIGHT", "INNER", "OUTER",
  "FULL", "CROSS", "UNION", "ALL", "WITH", "DISTINCT", "COUNT", "SUM", "AVG", "MIN", "MAX",
  "CASE", "WHEN", "THEN", "ELSE", "END", "PRIMARY", "KEY", "FOREIGN", "REFERENCES", "CONSTRAINT",
  "DEFAULT", "INDEX", "LIKE", "ILIKE", "BETWEEN", "IS", "RETURNING", "INTERVAL", "CAST", "COALESCE",
  "TRUNCATE", "GRANT", "REVOKE", "SCHEMA", "VIEW", "TRIGGER", "FUNCTION", "BEGIN", "COMMIT", "ROLLBACK",
] as const;

type CompletionCtx = {
  connectionId?: string;
  schemas: string[];
  getTables?: (schema: string) => Promise<string[]>;
  getColumns?: (schema: string, table: string) => Promise<string[]>;
};

const activeCtx: CompletionCtx = { schemas: [] };

const providersRegistered = new Set<unknown>();

// Per-connection caches: connectionId -> (schema -> tableNames | tableKey -> columnNames)
const tableCache = new Map<string, Map<string, string[]>>();
const tableInflight = new Map<string, Map<string, Promise<string[]>>>();
const columnCache = new Map<string, Map<string, string[]>>();
const columnInflight = new Map<string, Map<string, Promise<string[]>>>();

async function fetchTablesForSchema(connectionId: string, schema: string): Promise<string[]> {
  const fetchFn = activeCtx.getTables;
  if (!fetchFn) return [];
  let bySchema = tableCache.get(connectionId);
  if (!bySchema) { bySchema = new Map(); tableCache.set(connectionId, bySchema); }
  const cached = bySchema.get(schema);
  if (cached) return cached;
  let inFlight = tableInflight.get(connectionId);
  if (!inFlight) { inFlight = new Map(); tableInflight.set(connectionId, inFlight); }
  const pending = inFlight.get(schema);
  if (pending) return pending;
  const promise = fetchFn(schema)
    .then(names => { bySchema!.set(schema, names); return names; })
    .catch(() => { bySchema!.set(schema, []); return []; })
    .finally(() => { inFlight!.delete(schema); });
  inFlight.set(schema, promise);
  return promise;
}

async function fetchColumnsForTable(connectionId: string, schema: string, table: string): Promise<string[]> {
  const fetchFn = activeCtx.getColumns;
  if (!fetchFn) return [];
  const key = `${schema}.${table}`;
  let byTable = columnCache.get(connectionId);
  if (!byTable) { byTable = new Map(); columnCache.set(connectionId, byTable); }
  const cached = byTable.get(key);
  if (cached) return cached;
  let inFlight = columnInflight.get(connectionId);
  if (!inFlight) { inFlight = new Map(); columnInflight.set(connectionId, inFlight); }
  const pending = inFlight.get(key);
  if (pending) return pending;
  const promise = fetchFn(schema, table)
    .then(names => { byTable!.set(key, names); return names; })
    .catch(() => { byTable!.set(key, []); return []; })
    .finally(() => { inFlight!.delete(key); });
  inFlight.set(key, promise);
  return promise;
}

const TABLE_REF_RE = /(?:from|join|update|into|table|references)\s+[`"]?([A-Za-z_][\w$]*)[`"]?(?:\.([A-Za-z_][\w$]*))?/gi;

function collectReferencedTables(model: editor.ITextModel): { schema: string; table: string }[] {
  const refs: { schema: string; table: string }[] = [];
  const text = model.getValue();
  TABLE_REF_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TABLE_REF_RE.exec(text)) !== null) {
    const table = m[2];
    const schema = m[1];
    refs.push(table ? { schema, table } : { schema: "", table: schema });
  }
  return refs;
}

function registerCompletionProvider(monaco: any) {
  if (providersRegistered.has(monaco)) return;
  providersRegistered.add(monaco);

  monaco.languages.registerCompletionItemProvider("sql", {
    triggerCharacters: [".", '"', "'", "`"],
    async provideCompletionItems(model: editor.ITextModel, position: { lineNumber: number; column: number }) {
      const suggestions: any[] = [];
      const { connectionId, schemas, getTables, getColumns } = activeCtx;
      const word = model.getWordUntilPosition(position);
      const wordRange = {
        startLineNumber: position.lineNumber, endLineNumber: position.lineNumber,
        startColumn: word.startColumn, endColumn: word.endColumn,
      };
      const currentWord = word.word;

      if (!connectionId || !getTables || !getColumns) {
        for (const kw of SQL_KEYWORDS) {
          if (currentWord && !kw.toLowerCase().startsWith(currentWord.toLowerCase())) continue;
          suggestions.push({
            label: kw, kind: monaco.languages.CompletionItemKind.Keyword, insertText: kw, range: wordRange, sortText: "0",
          });
        }
        return { suggestions };
      }

      // Detect a preceding "<schema>." qualifier on the current line so we can filter
      // the table suggestions to that schema (e.g. `FROM public.|`).
      const linePrefix = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
      let schemaFilter: string | null = null;
      const qualifier = linePrefix.match(/([A-Za-z_][\w$]*)\.([\w$]*)$/);
      if (qualifier) { schemaFilter = qualifier[1]; }

      try {
        // 1) Keywords (prefix-filtered, keywords sort first)
        for (const kw of SQL_KEYWORDS) {
          if (currentWord && !kw.toLowerCase().startsWith(currentWord.toLowerCase())) continue;
          suggestions.push({ label: kw, kind: monaco.languages.CompletionItemKind.Keyword, insertText: kw, range: wordRange, sortText: "0" });
        }

        // 2) Tables (schema-aware, cached per connection)
        const schemaNames = schemas.length > 0 ? schemas : ["public"];
        const tableSchemas = new Map<string, string[]>();
        for (const schema of schemaNames) {
          const names = await fetchTablesForSchema(connectionId, schema);
          for (const name of names) {
            const list = tableSchemas.get(name);
            if (list) list.push(schema);
            else tableSchemas.set(name, [schema]);
          }
        }
        const seenTableLabels = new Set<string>();
        for (const [name, schemasOf] of tableSchemas) {
          if (currentWord && !name.toLowerCase().startsWith(currentWord.toLowerCase())) continue;
          if (schemaFilter) {
            if (!schemasOf.includes(schemaFilter)) continue;
            if (seenTableLabels.has(name)) continue;
            seenTableLabels.add(name);
            suggestions.push({ label: name, detail: `${schemaFilter}.${name}`, kind: monaco.languages.CompletionItemKind.Class, insertText: name, range: wordRange, sortText: "1" });
          } else {
            if (!seenTableLabels.has(name)) {
              seenTableLabels.add(name);
              suggestions.push({ label: name, detail: schemasOf.join(", "), kind: monaco.languages.CompletionItemKind.Class, insertText: name, range: wordRange, sortText: "1" });
            }
            for (const schema of schemasOf) {
              const qualified = `${schema}.${name}`;
              if (seenTableLabels.has(qualified)) continue;
              seenTableLabels.add(qualified);
              suggestions.push({ label: qualified, detail: schema, kind: monaco.languages.CompletionItemKind.Class, insertText: qualified, range: wordRange, sortText: "1" });
            }
          }
        }

        // 3) Columns for tables referenced in the query text (heuristic)
        const refs = collectReferencedTables(model);
        const seenColumnKeys = new Set<string>();
        for (const ref of refs) {
          const schemasToTry = ref.schema
            ? [ref.schema]
            : (tableSchemas.get(ref.table) || []);
          for (const schema of schemasToTry) {
            const columns = await fetchColumnsForTable(connectionId, schema, ref.table);
            for (const column of columns) {
              if (currentWord && !column.toLowerCase().startsWith(currentWord.toLowerCase())) continue;
              const key = `${schema}.${ref.table}.${column}`;
              if (seenColumnKeys.has(key)) continue;
              seenColumnKeys.add(key);
              suggestions.push({ label: column, detail: `${schema}.${ref.table}`, kind: monaco.languages.CompletionItemKind.Field, insertText: column, range: wordRange, sortText: "2" });
            }
          }
        }
      } catch (e) {
        // Never break the editor because of a completion error; keywords already added stay.
      }

      return { suggestions };
    },
  });
}

export function SQLEditor({
  value, onChange, onExecute, disabled = false, language = "sql",
  connectionId, schemas = [], getTables, getColumns,
}: SQLEditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const [monaco, setMonaco] = useState<any>(null);
  const [editorMonaco, setEditorMonaco] = useState<any>(null);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
    const obs = new MutationObserver(() => setDark(document.documentElement.classList.contains("dark")));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      import("monaco-editor").then(m => setMonaco(m));
    }
  }, []);

  // Keep the completion provider's context in sync on every render.
  useEffect(() => {
    activeCtx.connectionId = connectionId;
    activeCtx.schemas = schemas;
    activeCtx.getTables = getTables;
    activeCtx.getColumns = getColumns;
  });

  // Register the provider once against the monaco instance the editor actually uses.
  useEffect(() => {
    if (!editorMonaco || language !== "sql") return;
    registerCompletionProvider(editorMonaco);
  }, [editorMonaco, language]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !monaco) return;
    const handleKeyDown = (e: any) => {
      const isEnter = e.keyCode === monaco.KeyCode.Enter || e.keyCode === monaco.KeyCode.NumpadEnter;
      if ((e.metaKey || e.ctrlKey) && isEnter) {
        e.preventDefault();
        e.stopPropagation();
        if (!disabled) onExecute();
      }
    };
    const disposable = editor.onKeyDown(handleKeyDown);
    return () => disposable.dispose();
  }, [onExecute, disabled, monaco]);

  return (
    <div className="h-full border-t border-border">
      <Editor height="100%" defaultLanguage={language} language={language} theme={dark ? "vs-dark" : "vs"}
        value={value} onChange={val => onChange(val || "")}
        onMount={(editor, m) => { editorRef.current = editor; setEditorMonaco(m); }}
        options={{ minimap: { enabled: false }, fontSize: 14, lineNumbers: "on", scrollBeyondLastLine: false, wordWrap: "on", automaticLayout: true, tabSize: 2, readOnly: disabled }}
      />
    </div>
  );
}
