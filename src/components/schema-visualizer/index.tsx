"use client";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Loader2, Download, RotateCcw } from "lucide-react";
import type { ColumnInfo, TableNode, RelationshipEdge } from "./types";
import { TABLE_HEADER_HEIGHT, COLUMN_HEIGHT, TABLE_MIN_WIDTH, TABLE_PADDING } from "./types";
import type { SchemaInfo, ColumnInfo as RustColumnInfo, RelationshipInfo } from "@/lib/db/types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LockToggle } from "./lock-toggle";

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

function autoLayout(tables: TableNode[], relationships: RelationshipEdge[]) {
  if (!tables.length) return [];
  const tableMap = new Map(tables.map(t => [t.id, t]));
  const tableIds = tables.map(t => t.id);
  const deps = new Map<string, Set<string>>();
  const dependedBy = new Map<string, Set<string>>();
  for (const rel of relationships) {
    if (!deps.has(rel.from)) deps.set(rel.from, new Set());
    deps.get(rel.from)!.add(rel.to);
    if (!dependedBy.has(rel.to)) dependedBy.set(rel.to, new Set());
    dependedBy.get(rel.to)!.add(rel.from);
  }
  const inDegree = new Map<string, number>();
  for (const id of tableIds) inDegree.set(id, deps.get(id)?.size ?? 0);
  const layers: string[][] = [];
  const processed = new Set<string>();
  while (processed.size < tableIds.length) {
    let layer = tableIds.filter(id => !processed.has(id) && (inDegree.get(id) ?? 0) === 0);
    if (!layer.length) {
      let minD = Infinity;
      for (const id of tableIds) if (!processed.has(id)) minD = Math.min(minD, inDegree.get(id) ?? 0);
      layer = tableIds.filter(id => !processed.has(id) && (inDegree.get(id) ?? 0) === minD).slice(0, 1);
    }
    layer.sort();
    for (const id of layer) {
      processed.add(id);
      inDegree.set(id, 0);
      for (const dep of dependedBy.get(id) ?? []) if (!processed.has(dep)) inDegree.set(dep, (inDegree.get(dep) ?? 1) - 1);
    }
    layers.push(layer);
  }
  const H_GAP = 50, V_GAP = 60, PAD = 50;
  const positions: { id: string; x: number; y: number }[] = [];
  let curY = PAD;
  for (const layer of layers) {
    let curX = PAD, maxH = 0;
    for (const id of layer) {
      const t = tableMap.get(id);
      if (!t) continue;
      positions.push({ id, x: curX, y: curY });
      curX += t.width + H_GAP;
      maxH = Math.max(maxH, t.height);
    }
    curY += maxH + V_GAP;
  }
  return positions;
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
  const [isPanning, setIsPanning] = useState(false);
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
      // Fetch all tables' columns in parallel (per-table round trips were the
      // main load bottleneck — one await per table made large schemas crawl).
      const columnFetches = tablesData.map(async t => {
        try {
          const cols = await invoke<RustColumnInfo[]>("get_columns", {
            connectionId, schema: currentSchema, table: t.tableName,
          });
          return { t, cols };
        } catch {
          return { t, cols: [] as RustColumnInfo[] };
        }
      });
      const columnResults = await Promise.all(columnFetches);
      for (const { t, cols } of columnResults) {
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
          x: 0,
          y: 0,
          width: w,
          height: h,
        });
      }

      const layout = autoLayout(tableNodes, relEdges);
      for (const p of layout) {
        const t = tableNodes.find(n => n.id === p.id);
        if (t) { t.x = p.x; t.y = p.y; }
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
        ctx.textAlign = "left";
        const typeStartX = table.x + table.width * 0.5;
        const typeEndX = (col.isPrimaryKey || col.isForeignKey)
          ? table.x + table.width - 50
          : table.x + table.width - 10;
        let typeText = col.type;
        if (ctx.measureText(typeText).width > typeEndX - typeStartX) {
          while (ctx.measureText(typeText + "...").width > typeEndX - typeStartX && typeText.length > 0)
            typeText = typeText.slice(0, -1);
          typeText += "...";
        }
        ctx.fillText(typeText, typeStartX, cy);

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
    if (isLocked) { panRef.current = { startX: e.clientX, startY: e.clientY, origPan: { ...pan } }; setIsPanning(true); return; }
    const hit = hitTest(e.clientX, e.clientY);
    if (hit) {
      setSelectedTable(hit);
      const t = tables.find(t => t.id === hit)!;
      dragRef.current = { startX: e.clientX, startY: e.clientY, origX: t.x, origY: t.y };
      setDragTable(hit);
    } else {
      setSelectedTable(null);
      panRef.current = { startX: e.clientX, startY: e.clientY, origPan: { ...pan } };
      setIsPanning(true);
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

  const handleMouseUp = () => { dragRef.current = null; panRef.current = null; setDragTable(null); setIsPanning(false); };
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = -e.deltaY * 0.001;
    setZoom(z => Math.max(0.1, Math.min(3, z + delta)));
  };

  const exportPNG = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `schema-${currentSchema}-${Date.now()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  const bounds = useMemo(() => {
    if (tables.length === 0) return { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
    return {
      minX: Math.min(...tables.map(t => t.x)),
      minY: Math.min(...tables.map(t => t.y)),
      maxX: Math.max(...tables.map(t => t.x + t.width)),
      maxY: Math.max(...tables.map(t => t.y + t.height)),
    };
  }, [tables]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      {loading && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/60 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3">
            <div className="relative h-10 w-10">
              <div className="absolute inset-0 rounded-full border-2 border-primary/30" />
              <Loader2 className="absolute inset-0 m-auto h-5 w-5 animate-spin text-primary" />
            </div>
            <p className="text-sm text-muted-foreground">Loading schema…</p>
          </div>
        </div>
      )}
      {!loading && tables.length === 0 && (
        <div className="absolute inset-0 z-20 flex items-center justify-center text-sm text-muted-foreground">
          No tables found
        </div>
      )}
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        className={`absolute inset-0 ${isPanning ? 'cursor-grabbing' : 'cursor-grab'}`}
      />

      {/* Floating top-left toolbar: schema + refresh */}
      {schemas.length > 0 && (
        <div className="absolute top-3 left-3 z-20 flex items-center gap-1 rounded-lg border border-border bg-background/90 backdrop-blur-sm px-1.5 py-1 shadow-sm">
          <Select value={currentSchema} onValueChange={setCurrentSchema}>
            <SelectTrigger className="h-7 w-36 text-xs gap-1.5">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {schemas.map(s => <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <button onClick={loadSchema} disabled={loading}
            className="flex h-7 items-center gap-1 rounded px-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
            title="Refresh schema">
            <Loader2 className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      )}

      {/* Floating top-right toolbar: export / reset / lock */}
      <div className="absolute top-3 right-3 z-20 flex items-center gap-0.5 rounded-lg border border-border bg-background/90 backdrop-blur-sm px-1.5 py-1 shadow-sm">
        <button onClick={exportPNG} className="flex h-7 items-center gap-1 rounded px-2 text-xs text-muted-foreground transition-colors hover:text-foreground" title="Export PNG">
          <Download className="h-3.5 w-3.5" />
          <span className="hidden md:inline">Export PNG</span>
        </button>
        <span className="px-1 text-xs text-muted-foreground tabular-nums">{Math.round(zoom * 100)}%</span>
        <button onClick={() => {
          setZoom(0.8);
          setTables(prev => {
            const layout = autoLayout(prev, relationships);
            return prev.map(t => {
              const p = layout.find(l => l.id === t.id);
              return p ? { ...t, x: p.x, y: p.y } : t;
            });
          });
        }} className="flex h-7 items-center gap-1 rounded px-2 text-xs text-muted-foreground transition-colors hover:text-foreground" title="Reset layout">
          <RotateCcw className="h-3.5 w-3.5" />
          <span className="hidden md:inline">Reset</span>
        </button>
        <div className="mx-0.5 h-4 w-px bg-border" />
        <LockToggle locked={isLocked} onToggle={setIsLocked} className="h-7 w-7 justify-center" />
      </div>

      {/* Overview minimap */}
      {tables.length > 0 && (
        <div className="absolute bottom-4 right-4 z-20 bg-background/95 backdrop-blur-sm border border-border rounded-lg p-2">
          <div className="text-xs font-medium mb-1.5 text-muted-foreground">Overview</div>
          <div
            className="relative border border-border rounded"
            style={{ width: 180, height: 135, backgroundColor: dark ? "hsl(240, 4%, 14%)" : "hsl(0, 0%, 95%)" }}
          >
            <svg width="180" height="135" className="absolute inset-0" style={{ overflow: "visible" }}>
              {tables.map(table => {
                const pad = 200;
                const scaleX = 180 / (bounds.maxX - bounds.minX + pad);
                const scaleY = 135 / (bounds.maxY - bounds.minY + pad);
                return (
                  <rect
                    key={table.id}
                    x={(table.x - bounds.minX) * scaleX}
                    y={(table.y - bounds.minY) * scaleY}
                    width={Math.max(2, table.width * scaleX)}
                    height={Math.max(2, table.height * scaleY)}
                    fill="hsla(212, 100%, 55%, 0.3)"
                    stroke="hsl(212, 100%, 55%)"
                    strokeWidth={1}
                  />
                );
              })}
            </svg>
          </div>
        </div>
      )}
    </div>
  );
}
