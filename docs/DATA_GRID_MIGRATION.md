# Data Grid Migration: Feature Inventory

This documents every behavior of the current data grid before migrating to
Glide Data Grid. Each item must be replicated in the Glide implementation.

## Data flow / architecture
- `ResultsViewer` (in `src/components/results-viewer/ResultsViewerCore.tsx`) is the
  grid. It receives `result` (rows + column metas), `loading`, `error`, `schema`,
  `table`, `connectionId`, `pkColumns`, `columnsMeta`, `enableCRUD`, `readOnly`,
  `sort`/`onSortChange` (server-side sort), `hiddenColumns`.
- Rows come from `displayResult.rows` (raw DB values from `pg_value`), columns from
  `displayResult.columns` (`{name, dataType}`).
- `paginatedRows = sortedRows` (server pre-sorts when `onSortChange` is set).
- Edit operations produce `PendingChange` records; the grid displays staged changes
  (amber highlight) but does NOT write until "Apply" runs `API.mutateRows` which
  executes all statements atomically in one DB transaction (backend `pg_mutate`).

## Features to preserve

### 1. Cell rendering by type (backend value shapes)
- **int2/int4/int8, float4/float8** → JSON number; plain text display.
- **numeric / decimal / money** → JSON **string** (via `numeric_bytes_to_string`) to
  avoid JS float precision loss. Must display full precision, never blank.
- **bool** → JSON boolean; rendered as a select with true/false/NULL.
- **text/varchar/char/name** → JSON string; plain text.
- **date/time/timestamp/timestamptz** → JSON string; plain text (formatted for edit).
- **json/jsonb** → JSON value (object/array); displayed as JSON text, editable as JSON
  text. Must NOT render blank for objects/arrays.
- **bytea** → JSON string `"\x<hex>"`; displayed as `\x…`, never blank.
- **arrays** (`_int4`, `_text`, `_numeric`, `_bool`, `_jsonb`, `_bytea`, enum arrays) →
  JSON array; displayed as JSON text, never blank.
- **user-defined enum** → JSON string (raw label bytes); editable via a select of the
  enum's values (fetched via `get_enum_values`).
- **unknown/custom types** → JSON string; plain text.

### 2. Inline cell editing
- Double-click (or Enter on selected cell) starts editing a cell.
- Boolean → inline select (true/false/NULL).
- Enum → inline select of enum values + NULL.
- date → `date` input; timestamp/time → `datetime-local` input.
- numeric types → `number` input.
- text/textarea/json/bytea/array → text input/textarea.
- Commit on Enter/blur; Escape cancels.
- Edits are **parameterized** (never string-built SQL): a `PendingChange` with
  `{query: UPDATE ... SET col = $1 WHERE pk = $2, params: [...]}` built in
  `handleApplyAll`. `toSqlParamValue` converts the input string to the typed param.
- Staged edits show an **amber** background/ring on the affected cell.

### 3. Row selection & delete
- Row checkbox column (sticky left), select-all in header.
- Multi-row selection; "Delete Selected (N)" appears when rows selected.
- Delete goes through a **confirmation dialog** (ConfirmDialog), then stages
  `DELETE` statements (parameterized by PK) as pending changes.
- Staged deletes are shown with reduced opacity / strikethrough.
- Deleting from the row inspector (`RowEditorPanel`) also stages a delete.

### 4. Insert row
- "Insert Row" opens the row inspector sidebar in insert mode.
- Identity columns are disabled (auto-generated).
- Insert produces a parameterized `INSERT` statement, staged as a pending change.
- Staged insert rows are shown in the grid with a dashed emerald indicator.

### 5. Staged changes & atomic apply
- "Review (N) changes" button (amber, with border beam) opens the review panel.
- Review panel lists pending changes with GitHub-style diff (red struck old value,
  green new value).
- "Apply" runs all statements in **one transaction** via `API.mutateRows`.
- After apply: rows updated in place, pending cleared, toast success, refresh.

### 6. Sorting
- Click header to cycle asc → desc → off (server-side via `onSortChange`).
- Sort indicators (↑/↓), and a sort dropdown / context menu with per-type options.
- Only one column sorted at a time.

### 7. Pagination & row count
- Pagination controls live in the DatabaseView toolbar (not in ResultsViewer).
- `page`/`pageSize`, total count display, page size picker.
- ResultsViewer shows the current page's rows; Glide grid shows those rows.

### 8. Export
- CSV / JSON export and "Copy as JSON" from an Export menu (query view) or the
  DatabaseView `#export-slot` (table view).

### 9. Row inspector (sidebar) integration
- Clicking a row opens the right sidebar `RowEditorPanel` for editing that row.
- Inline edits keep the inspector in sync (shows staged values, amber highlight on
  edited fields).

### 10. Visual style
- shadcn/Tailwind tokens: `--background`, `--foreground`, `--border`, `--muted`,
  `--accent`, `--primary`, `--destructive`, `--table-header`, amber for staged,
  emerald for inserts.
- Light and dark mode via `.dark` class on `<html>`.

## Constraints for the migration
- **Do not regress parameterized edits** — inline edits must still build
  parameterized UPDATE/INSERT/DELETE statements.
- **Do not reintroduce blank/null display** for JSONB, arrays, bytea, large decimals.
- Preserve virtualization benefit: Glide is canvas-based; feed it all rows for the
  current page and let it virtualize.
- Do not remove the old implementation until the new one passes tests + checklist.
