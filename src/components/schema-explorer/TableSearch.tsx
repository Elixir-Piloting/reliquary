"use client";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

interface TableSearchProps { value: string; onChange: (value: string) => void; }

export function TableSearch({ value, onChange }: TableSearchProps) {
  return (
    <div className="relative">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="Search tables..." className="pl-8 h-8 text-xs" />
    </div>
  );
}
