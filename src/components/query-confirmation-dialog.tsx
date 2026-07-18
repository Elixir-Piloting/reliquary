"use client";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Shield } from "lucide-react";

interface QueryConfirmationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function QueryConfirmationDialog({ open, onOpenChange, query, onConfirm, onCancel }: QueryConfirmationDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Shield className="h-5 w-5" />Confirm Destructive Query</DialogTitle>
          <DialogDescription>Safe Mode requires confirmation before executing this query.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <h4 className="text-sm font-medium mb-2">Query:</h4>
            <pre className="bg-muted p-3 rounded-md text-xs overflow-x-auto max-h-40">{query}</pre>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={onConfirm} className="gap-2"><Shield className="h-4 w-4" />Proceed Anyway</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
