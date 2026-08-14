"use client";
import { useState } from "react";
import { Database, Loader2, Plus } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import API from "@/lib/ipc-client";

interface SchemaSelectorProps {
  connectionId: string;
  schemas: string[];
  selectedSchema: string | null;
  onSchemaSelect: (schema: string) => void;
  onSchemaCreated: (schema: string) => void;
}

export function SchemaSelector({ connectionId, schemas, selectedSchema, onSchemaSelect, onSchemaCreated }: SchemaSelectorProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const createSchema = async () => {
    const name = newName.trim();
    if (!name) { toast.error("Schema name is required"); return; }
    setCreating(true);
    try {
      await API.createSchema(connectionId, name);
      toast.success(`Schema "${name}" created`);
      setCreateOpen(false);
      setNewName("");
      onSchemaCreated(name);
    } catch (e) {
      toast.error("Failed to create schema", { description: String(e) });
    }
    setCreating(false);
  };

  return (
    <>
      <div className="flex items-center gap-1">
        <Select value={selectedSchema ?? undefined} onValueChange={onSchemaSelect}>
          <SelectTrigger className="h-7 w-full text-xs gap-1.5">
            <Database className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <SelectValue placeholder="Select schema" />
          </SelectTrigger>
          <SelectContent>
            {schemas.map(s => (
              <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
            ))}
            <div className="border-t border-border mt-1 pt-1">
              <button onClick={() => setCreateOpen(true)}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground">
                <Plus className="h-3.5 w-3.5" /> Create schema…
              </button>
            </div>
          </SelectContent>
        </Select>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create schema</DialogTitle>
            <DialogDescription>Create a new schema in the current database.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="schema-name">Schema name</Label>
            <Input id="schema-name" value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. analytics" autoFocus
              onKeyDown={e => { if (e.key === "Enter") createSchema(); }} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>Cancel</Button>
            <Button onClick={createSchema} disabled={creating}>
              {creating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
