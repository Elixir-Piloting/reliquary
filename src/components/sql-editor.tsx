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
}

export function SQLEditor({ value, onChange, onExecute, disabled = false, language = "sql" }: SQLEditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const [monaco, setMonaco] = useState<any>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      import("monaco-editor").then(m => setMonaco(m));
    }
  }, []);

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
      <Editor height="100%" defaultLanguage={language} language={language} theme="vs-dark"
        value={value} onChange={val => onChange(val || "")}
        onMount={editor => { editorRef.current = editor; }}
        options={{ minimap: { enabled: false }, fontSize: 14, lineNumbers: "on", scrollBeyondLastLine: false, wordWrap: "on", automaticLayout: true, tabSize: 2, readOnly: disabled }}
      />
    </div>
  );
}
