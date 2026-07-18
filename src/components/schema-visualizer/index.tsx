"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Loader2 } from "lucide-react";
import type { ColumnInfo, TableNode, RelationshipEdge } from "./types";
import { TABLE_HEADER_HEIGHT, COLUMN_HEIGHT, TABLE_MIN_WIDTH, TABLE_PADDING } from "./types";
import type { SchemaInfo, ColumnInfo as RustColumnInfo, RelationshipInfo } from "@/lib/db/types";

function isDarkMode() {
  if (typeof window === "undefined") return false;
  return document.documentElement.classList.contains("dark");
}

function themeColors(isDark: boolean) {
  return {
    background: isDark ? "hsl(240, 6%, 5%)" : "hsl(0, 0%, 98%)",
    surface: isDark ? "hsl(240, 6%, 8%)" : "hsl(0, 0%, 100%)",
    surfaceHover: isDark ? "hsl(240, 6%, 10%)" : "hsl(0, 0%, 96%)",
    border: isDark ? "hsl(240, 4%, 18%)" : "hsl(0, 0%, 90%)",
    text: isDark ? "hsl(0, 0%, 96%)" : "hsl(240, 6%, 10%)",
    textMuted: isDark ? "hsl(240, 5%, 55%)" : "hsl(240, 4%, 40%)",
    primary: "hsl(212, 100%, 55%)",
    primaryLight: "hsl(212, 100%, 65%)",
    warning: "hsl(45, 93%, 58%)",
  };
}

export default function SchemaVisualizer({ connectionId }: { connectionId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [schemas, setSchemas] = useState<string[]>([]);
  const [currentSchema, setCurrentSchema] = useState<string>("public");
  const [tables, setTables] = useState<TableNode[]>([]);
  const [relationships, setRelationships] = useState<RelationshipEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [dragTable, setDragTable] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0.8);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isLocked, setIsLocked] = useState(false);
  const [dark, setDark] = useState(() => isDarkMode());
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const panRef = useRef<{ startX: number; startY: number; origPan: { x: number; y: number } } | null>(null);

  useEffect(() => {
    const obs = new MutationObserver(() => setDark(document.documentElement.classList.contains("dark")));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    invoke<SchemaInfo[]>("get_schemas", { connectionId }).then(r => {
      const names = r.map(s => s.schemaName);
      setSchemas(names);
      if (names.length > 0) setCurrentSchema(names[0]);
    }).catch(console.error);
  }, [connectionId]);

  const loadSchema = useCallback(async () => {
    if (!connectionId || !currentSchema) return;
    setLoading(true);
    try {
      const [tablesData, rels] = await Promise.all([
        invoke<any[]>("get_tables", { connectionId, schema: currentSchema }),
        invoke<RelationshipInfo[]>("get_schema_relationships", { connectionId, schema: currentSchema }),
      ]);

      const fkColumnSet = new Set<string>();
      for (const rel of rels) {
        fkColumnSet.add(`${rel.sourceSchema}.${rel.sourceTable}.${rel.sourceColumn}`);
        fkColumnSet.add(`${rel.targetSchema}.${rel.targetTable}.${rel.targetColumn}`);
      }

      const relEdges: RelationshipEdge[] = rels.map(r => ({
        id: `${r.sourceSchema}.${r.sourceTable}-${r.targetSchema}.${r.targetTable}-${r.sourceColumn}`,
        from: `${r.sourceSchema}.${r.sourceTable}`,
        to: `${r.targetSchema}.${r.targetTable}`,
        fromColumn: r.sourceColumn,
        toColumn: r.targetColumn,
        constraintName: r.constraintName,
      }));

      const tableNodes: TableNode[] = [];
      for (let i = 0; i < tablesData.length; i++) {
        const t = tablesData[i];
        try {
          const cols = await invoke<RustColumnInfo[]>("get_columns", {
            connectionId, schema: currentSchema, table: t.tableName,
          });
          const columns: ColumnInfo[] = cols.map(c => ({
            name: c.columnName,
            type: c.dataType,
            isPrimaryKey: c.isPrimaryKey,
            isForeignKey: fkColumnSet.has(`${currentSchema}.${t.tableName}.${c.columnName}`),
            isNullable: c.isNullable,
          }));
          const h = TABLE_HEADER_HEIGHT + columns.length * COLUMN_HEIGHT + TABLE_PADDING;
          const maxNameLen = Math.max(...columns.map(c => c.name.length), 10);
          const maxTypeLen = Math.max(...columns.map(c => c.type.length), 15);
          const w = Math.min(Math.max(TABLE_MIN_WIDTH, Math.max(maxNameLen * 7, maxTypeLen * 6) + 60), 350);
          tableNodes.push({
            id: `${currentSchema}.${t.tableName}`,
            schema: currentSchema,
            name: t.tableName,
            columns,
            x: (i % 6) * 280 + 50,
            y: Math.floor(i / 6) * 250 + 50,
            width: w,
            height: h,
          });
        } catch { }
      }

      setTables(tableNodes);
      setRelationships(relEdges);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [connectionId, currentSchema]);

  useEffect(() => { loadSchema(); }, [loadSchema]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const container = canvas.parentElement;
    if (!container) return;

    const colors = themeColors(dark);
    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();

    ctx.textBaseline = "middle";
    ctx.imageSmoothingEnabled = true;

    ctx.fillStyle = colors.background;
    ctx.fillRect(0, 0, rect.width, rect.height);

    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    // Draw relationships
    for (const rel of relationships) {
      const fromTable = tables.find(t => t.id === rel.from);
      const toTable = tables.find(t => t.id === rel.to);
      if (!fromTable || !toTable) continue;

      const fromColIdx = fromTable.columns.findIndex(c => c.name === rel.fromColumn);
      const toColIdx = toTable.columns.findIndex(c => c.name === rel.toColumn);
      if (fromColIdx < 0 || toColIdx < 0) continue;

      const fromX = fromTable.x + fromTable.width;
      const fromY = fromTable.y + TABLE_HEADER_HEIGHT + fromColIdx * COLUMN_HEIGHT + COLUMN_HEIGHT / 2;
      const toX = toTable.x;
      const toY = toTable.y + TABLE_HEADER_HEIGHT + toColIdx * COLUMN_HEIGHT + COLUMN_HEIGHT / 2;

      const offset = 40;
      const dx = toX - fromX;
      const dy = toY - fromY;
      const midX = fromX + offset;
      const pts = [
        { x: fromX, y: fromY },
        { x: midX, y: fromY },
        { x: midX, y: toY },
        { x: toX, y: toY },
      ];

      const highlighted = selectedTable === rel.from || selectedTable === rel.to;
      ctx.strokeStyle = highlighted ? colors.primary : colors.primaryLight;
      ctx.lineWidth = highlighted ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();

      // Arrow
      const angle = Math.atan2(pts[3].y - pts[2].y, pts[3].x - pts[2].x);
      const al = 10;
      const as = Math.PI / 6;
      ctx.beginPath();
      ctx.moveTo(toX, toY);
      ctx.lineTo(toX - al * Math.cos(angle - as), toY - al * Math.sin(angle - as));
      ctx.moveTo(toX, toY);
      ctx.lineTo(toX - al * Math.cos(angle + as), toY - al * Math.sin(angle + as));
      ctx.stroke();
    }

    // Draw tables
    const sortedTables = [...tables].sort((a, b) => {
      if (a.id === dragTable) return 1;
      if (b.id === dragTable) return -1;
      if (a.id === selectedTable) return 1;
      if (b.id === selectedTable) return -1;
      return 0;
    });

    for (const table of sortedTables) {
      const sel = selectedTable === table.id;
      const drag = dragTable === table.id;

      // Table body
      ctx.fillStyle = drag ? colors.surfaceHover : sel ? colors.surface : colors.background;
      ctx.strokeStyle = drag || sel ? colors.primary : colors.border;
      ctx.lineWidth = drag ? 2.5 : sel ? 2 : 1.5;
      const r = 4;
      ctx.beginPath();
      ctx.roundRect(table.x, table.y, table.width, table.height, r);
      ctx.fill();
      ctx.stroke();

      // Header
      ctx.fillStyle = sel ? colors.primary : dark ? "hsl(240, 3.7%, 22%)" : "hsl(0, 0%, 94%)";
      ctx.beginPath();
      ctx.moveTo(table.x + r, table.y);
      ctx.lineTo(table.x + table.width - r, table.y);
      ctx.quadraticCurveTo(table.x + table.width, table.y, table.x + table.width, table.y + r);
      ctx.lineTo(table.x + table.width, table.y + TABLE_HEADER_HEIGHT);
      ctx.lineTo(table.x, table.y + TABLE_HEADER_HEIGHT);
      ctx.lineTo(table.x, table.y + r);
      ctx.quadraticCurveTo(table.x, table.y, table.x + r, table.y);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = sel ? "hsl(0, 0%, 100%)" : colors.text;
      ctx.font = "600 13px system-ui, -apple-system, sans-serif";
      ctx.textAlign = "left";
      let nameText = table.name;
      if (ctx.measureText(nameText).width > table.width - 20) {
        while (ctx.measureText(nameText + "...").width > table.width - 20 && nameText.length > 0) nameText = nameText.slice(0, -1);
        nameText += "...";
      }
      ctx.fillText(nameText, table.x + 10, table.y + TABLE_HEADER_HEIGHT / 2);

      // Columns
      for (let ci = 0; ci < table.columns.length; ci++) {
        const col = table.columns[ci];
        const cy = table.y + TABLE_HEADER_HEIGHT + ci * COLUMN_HEIGHT + COLUMN_HEIGHT / 2;
        ctx.fillStyle = colors.text;
        ctx.font = "11px system-ui, -apple-system, sans-serif";
        ctx.fillText(col.name, table.x + 10, cy);

        ctx.fillStyle = colors.textMuted;
        ctx.font = "10px system-ui, -apple-system, sans-serif";
        ctx.fillText(col.type, table.x + table.width * 0.5, cy);

        const iconX = table.x + table.width - 40;
        if (col.isPrimaryKey) {
          ctx.fillStyle = colors.warning;
          ctx.font = "9px system-ui, -apple-system, sans-serif";
          ctx.textAlign = "right";
          ctx.fillText("PK", iconX, cy);
          ctx.textAlign = "left";
        }
        if (col.isForeignKey) {
          ctx.fillStyle = colors.primary;
          ctx.font = "9px system-ui, -apple-system, sans-serif";
          ctx.textAlign = "right";
          ctx.fillText("FK", col.isPrimaryKey ? iconX - 25 : iconX, cy);
          ctx.textAlign = "left";
        }
      }
    }

    ctx.restore();
  }, [tables, relationships, selectedTable, dragTable, zoom, pan, dark]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = canvas?.parentElement;
    if (!canvas || !container) return;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.scale(dpr, dpr);
      draw();
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [draw]);

  useEffect(() => { draw(); }, [draw]);

  const hitTest = (clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const mx = (clientX - rect.left - pan.x) / zoom;
    const my = (clientY - rect.top - pan.y) / zoom;
    for (let i = tables.length - 1; i >= 0; i--) {
      const t = tables[i];
      if (mx >= t.x && mx <= t.x + t.width && my >= t.y && my <= t.y + t.height) return t.id;
    }
    return null;
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (isLocked) { panRef.current = { startX: e.clientX, startY: e.clientY, origPan: { ...pan } }; return; }
    const hit = hitTest(e.clientX, e.clientY);
    if (hit) {
      setSelectedTable(hit);
      const t = tables.find(t => t.id === hit)!;
      dragRef.current = { startX: e.clientX, startY: e.clientY, origX: t.x, origY: t.y };
      setDragTable(hit);
    } else {
      setSelectedTable(null);
      panRef.current = { startX: e.clientX, startY: e.clientY, origPan: { ...pan } };
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (dragRef.current) {
      const dx = (e.clientX - dragRef.current.startX) / zoom;
      const dy = (e.clientY - dragRef.current.startY) / zoom;
      const origX = dragRef.current.origX;
      const origY = dragRef.current.origY;
      setTables(prev => prev.map(t => t.id === dragTable ? { ...t, x: origX + dx, y: origY + dy } : t));
    } else if (panRef.current) {
      setPan({ x: panRef.current.origPan.x + e.clientX - panRef.current.startX, y: panRef.current.origPan.y + e.clientY - panRef.current.startY });
    }
  };

  const handleMouseUp = () => { dragRef.current = null; panRef.current = null; setDragTable(null); };
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = -e.deltaY * 0.001;
    setZoom(z => Math.max(0.1, Math.min(3, z + delta)));
  };

  return (
    <div className="flex flex-col h-full">
      <div className="h-10 border-b border-border flex items-center justify-between px-4 shrink-0 bg-muted/10">
        <div className="flex items-center gap-2">
          <select value={currentSchema} onChange={e => setCurrentSchema(e.target.value)}
            className="h-7 text-xs rounded border border-input bg-background px-2">
            {schemas.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button onClick={loadSchema} disabled={loading}
            className="h-7 px-2 text-xs rounded border border-input bg-background hover:bg-accent">
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Refresh"}
          </button>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(0.8)} className="hover:text-foreground">Reset</button>
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="checkbox" checked={isLocked} onChange={e => setIsLocked(e.target.checked)} className="h-3 w-3" />
            Lock
          </label>
        </div>
      </div>
      <div className="flex-1 relative overflow-hidden">
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading schema...
          </div>
        ) : tables.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">
            No tables found
          </div>
        ) : null}
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
          className="absolute inset-0 cursor-move"
        />
      </div>
    </div>
  );
}
