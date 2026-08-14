"use client";
import { useEffect, useState } from "react";
import Editor from "@monaco-editor/react";
import { Button } from "@/components/ui/button";
import { RotateCcw, ChevronRight } from "lucide-react";

interface CreateTableSqlPanelProps {
  sql: string;
  schema: string;
  table: string;
  onClose: () => void;
}

/**
 * Right-sidebar panel that shows the table-builder's generated CREATE TABLE SQL
 * in a Monaco editor. The SQL is editable as a preview; the Reset button
 * restores it to what the table builder generated.
 */
export function CreateTableSqlPanel({ sql, schema, table, onClose }: CreateTableSqlPanelProps) {
  const [value, setValue] = useState(sql);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
    const obs = new MutationObserver(() => setDark(document.documentElement.classList.contains("dark")));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  // Keep the preview in sync when the builder regenerates the SQL.
  useEffect(() => { setValue(sql); }, [sql]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight">Create Table — SQL</p>
          <p className="truncate font-mono text-xs text-muted-foreground">{schema}.{table || "new_table"}</p>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} title="Close editor"><ChevronRight className="h-4 w-4" /></Button>
      </div>
      <div className="shrink-0 border-b border-border px-3 py-2 text-xs text-muted-foreground">
        Preview of the SQL the table builder will run. Edit freely; <span className="text-foreground">Reset</span> restores the builder&apos;s version.
      </div>
      <div className="create-table-sql flex flex-1 flex-col border-t border-border">
        <Editor
          height="100%"
          language="sql"
          theme={dark ? "vs-dark" : "vs"}
          value={value}
          onChange={v => setValue(v || "")}
          options={{ minimap: { enabled: false }, fontSize: 13, lineNumbers: "off", scrollBeyondLastLine: false, wordWrap: "on", automaticLayout: true, tabSize: 2, padding: { top: 8, bottom: 8 } }}
        />
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-border px-3 py-2.5">
        <Button variant="outline" size="sm" onClick={() => setValue(sql)}>
          <RotateCcw className="h-3.5 w-3.5 mr-1" />Reset
        </Button>
      </div>
    </div>
  );
}
