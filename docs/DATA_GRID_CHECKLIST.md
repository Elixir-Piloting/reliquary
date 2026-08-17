# Data Grid Migration: Old vs New Parity Checklist

Status of each inventory item after switching to Glide Data Grid (behind the
`USE_GLIDE_GRID` flag in `ResultsViewerCore.tsx`). The old shadcn/Table
implementation is still present and can be restored by flipping the flag.

| # | Feature | Old (shadcn/Table) | New (Glide) | Status |
|---|---------|--------------------|-------------|--------|
| 1a | int/float display | JSON number | Glide `Number` cell | ✅ |
| 1b | numeric/decimal/money (string, full precision) | text display, no precision loss | Glide `Text` cell carrying the string | ✅ |
| 1c | bool | inline select | Glide `Boolean` cell (editable) | ✅ |
| 1d | text/varchar/char | plain text | Glide `Text` cell | ✅ |
| 1e | date/time/timestamp | plain text (+ edit) | Glide `Text` cell | ✅ |
| 1f | json/jsonb | JSON text display, editable | Glide `Text` cell (JSON text, never blank) | ✅ |
| 1g | bytea | `\x<hex>` text | Glide `Text` cell (never blank) | ✅ |
| 1h | arrays | JSON text display | Glide `Text` cell (JSON text, never blank) | ✅ |
| 1i | enum | inline select of values | Glide `Text` cell (custom editor not yet wired — see flags) | ⚠️ |
| 1j | unknown/custom | plain text | Glide `Text` cell | ✅ |
| 2a | inline cell editing | input/select on dbl-click | Glide built-in editor (dbl-click/Enter) | ✅ |
| 2b | parameterized edits (no string-built SQL) | UPDATE ... SET col=$1 WHERE pk=$2 | Same via `buildUpdateChange` + `toSqlParamValue` | ✅ |
| 2c | staged-edit amber highlight | amber bg/ring on cell | Not yet rendered in Glide (see flags) | ⚠️ |
| 3a | row selection (checkbox) | checkbox column | Glide row markers (checkbox-visible) | ✅ |
| 3b | delete confirmation dialog | ConfirmDialog | Glide `onDelete` + ConfirmDialog | ✅ |
| 3c | parameterized delete by PK | DELETE ... WHERE pk=$1 | Same via `buildDeleteChange` | ✅ |
| 4a | insert row | inspector insert mode | Glide grid uses inspector insert (button remains) | ⚠️ |
| 4b | identity columns excluded on insert | excluded | Same via `buildInsertChange` | ✅ |
| 5a | review changes panel | sidebar panel + border beam | Unchanged (lives outside grid) | ✅ |
| 5b | atomic apply (one transaction) | `API.mutateRows` | Unchanged (same `handleApplyAll`) | ✅ |
| 6a | header sort cycling + indicators | click header → asc/desc/off | Glide header click not wired to sort yet (see flags) | ⚠️ |
| 7a | pagination + total row count | toolbar | Unchanged (lives in DatabaseView) | ✅ |
| 8a | CSV/JSON export + copy JSON | export menu | Unchanged (lives outside grid) | ✅ |
| 9a | row inspector on click | click row → sidebar | Glide `onCellClicked` → open row | ✅ |
| 10a | light/dark theme | CSS vars | Glide theme object mapped from the same vars | ✅ |
| — | native column resize | none (hand-rolled widths) | Glide `onColumnResize` freeform | ✅ |
| — | double-click auto-fit column | none | Glide `remeasureColumns` (via ref) | ⚠️ (needs wiring) |
| — | virtualization for large sets | DOM table | Glide canvas (built-in) | ✅ |

## Items that could NOT be fully replicated yet (review manually)

1. **Enum cell editor** — enums still display correctly (text) but the dedicated
   inline select of enum values is not wired into Glide's custom editor. Editing an
   enum column currently falls back to the generic text editor. To fully match the
   old UX, add a custom cell renderer/editor for enum columns that reads
   `get_enum_values`. (Backend `get_enum_values` + `enumCache` are already passed in.)
2. **Staged-edit amber highlight in the grid** — staged cell changes show amber in
   the old grid. Glide needs a `getCellContent` overlay (e.g. via `themeOverride`
   or a `CustomCell` renderer) to tint staged cells amber. Not yet implemented.
3. **Header sort cycling/indicators** — Glide doesn't sort internally; clicking a
   header isn't wired to the existing `onSortChange` (server-side sort). The old
   header sort popover/context-menu behavior is not reproduced in Glide.
4. **Insert-row flow** — the "Insert Row" button still opens the sidebar inspector
   to stage an insert (that part works), but Glide's built-in trailing-row /
   `onRowAppended` insert-in-grid path is not implemented. The insert still works
   via the sidebar, matching the old behavior.
5. **Double-click auto-fit column** — Glide exposes `remeasureColumns` on the ref
   but a double-click handler to trigger it isn't wired.

These are flagged so they can be reviewed manually. Everything else (type-safe
display, parameterized editing, atomic apply, selection, delete confirm, export,
pagination, row inspector, theme) is preserved.
