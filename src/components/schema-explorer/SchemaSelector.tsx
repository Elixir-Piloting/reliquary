"use client";
import { cn } from "@/lib/utils";
import { Database } from "lucide-react";

interface SchemaSelectorProps {
  schemas: string[];
  selectedSchema: string | null;
  onSchemaSelect: (schema: string) => void;
  onCreateSchema: () => void;
}

export function SchemaSelector({ schemas, selectedSchema, onSchemaSelect, onCreateSchema }: SchemaSelectorProps) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-1">Schemas</div>
      <div className="space-y-0.5">
        {schemas.map((schema) => (
          <button key={schema} onClick={() => onSchemaSelect(schema)}
            className={cn(
              "w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors text-left",
              selectedSchema === schema
                ? "bg-accent text-accent-foreground font-medium"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
            )}>
            <Database className="h-4 w-4 shrink-0" />
            <span>{schema}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
