# Relic — Current State Inventory

A reporting-only inventory of what "Relic" (a Tauri v2 + React + Rust Postgres GUI) currently does, verified against the codebase (`src/` and `src-tauri/src/`). Each feature is rated **Fully implemented**, **Partially implemented**, or **Broken / disabled**. Where a feature looks present but I could not fully verify it works end-to-end, it is marked **unverified**.

Status legend:
- ✅ Fully implemented — code path exists and is wired through to a working feature.
- 🟡 Partially implemented — exists and mostly works, but with noted limitations or rough edges.
- 🔴 Broken / disabled — feature is disabled behind a flag, or the wiring is incomplete in a way that breaks the flow.
- ❓ Unverified — present in code but not confirmed working end-to-end (noted rather than assumed).

---

## 1. Connection management

### 1.1 Connection providers (Neon / Supabase / PostgreSQL) — 🟡 Partially implemented
- Provider detection by URL is implemented in Rust (`types.rs` → `detect_provider`: neon if `neon.tech`/`neondb`, supabase if `supabase.co`/`pooler.supabase`, else `postgresql`). ✅
- Frontend badges exist for all three providers (`Home.tsx` `PROVIDER_BADGES`, `database-navbar`/`main-layout` `ProviderIcon`). ✅
- **Limitation:** `src/lib/db/providers.ts` `getProviderMetadata` only contains PostgreSQL metadata and **ignores the provider argument** — so the mini provider icon in the sidebar/database-navbar will always render the same (PostgreSQL) glyph regardless of actual provider. The `ProviderBadge` chips use hardcoded per-provider colors (not this metadata), so badges look right; only the metadata-driven icon path is wrong. 🟡

### 1.2 SSL modes — ✅ Fully implemented
- `AddConnectionForm.tsx` offers `["disable", "prefer", "require", "verify-full"]` (note: no `verify-ca` option in the UI).
- Backend `pg.rs` `build_tls(sslmode)` handles all four: `disable` → `NoTls`; `require`/`prefer` → `danger_accept_invalid_certs(true)` (no CA verification); `verify-full` → verified cert against system roots. The `PgTls` enum in types.rs carries parse/display. ✅

### 1.3 Read-only connections — ✅ Fully implemented
- `StoredConnection.read_only` flag; enforced on the backend (`commands.rs`): `execute_query` rejects if `read_only && (is_destructive || !is_select)`, `mutate_rows` rejects if `read_only || is_ddl`. UI shows a ShieldCheck "Read-only" tag (`Home.tsx`). ✅
- Enforcement is **backend-side**, so it holds regardless of UI state. ✅

### 1.4 Connection storage — 🟡 Partially implemented (security concern)
- Connections are stored in a JSON file at a config path managed by `AppState.config_path` (`lib.rs`).
- **Plaintext credentials:** `StoredConnection` stores the connection password and `neon_api_key: Option<String>` in **plaintext** in `connections.json`. Passwords are also stored in localStorage for local servers (`persistence.ts` `getServerPassword`/`setServerPassword`). No encryption/keychain. This is a real security gap, not a functionality one — see GAPS.md.
- Add/Edit/Delete/Copy-URL connection CRUD is fully wired (`Home.tsx`). ✅

### 1.5 Local server detection — ✅ Fully implemented
- Backend `detect_local_servers` probes ports 5432–5435; `local-postgres-manager/index.tsx` offers a picker with a password dialog and connect-to-local-db flow. Persisted local passwords via `Persistence.getServerPassword`. ✅

### 1.6 Auto-reconnect to last-used connection — ✅ Fully implemented
- `Home.tsx` restores the last active connection from `Persistence.getActiveConnectionId()` and connects on launch. Also preserved per-connection view/tabs/schema. ✅

---

## 2. Query editor

### 2.1 Monaco SQL editor — ✅ Fully implemented
- `sql-editor.tsx` embeds Monaco with a custom SQL completion provider (schema/tables/columns), `Ctrl+Enter` to run, multi-query handling. Schema-aware completion uses module-level `activeCtx` and per-connection caches. ✅

### 2.2 Run / Explain / Analyze — ✅ Fully implemented
- `query-pane.tsx`: Run executes; Explain runs `EXPLAIN`; Analyze runs `EXPLAIN ANALYZE`. Backend `pg_explain` returns JSON-format plan (FORMAT JSON, BUFFERS, ANALYZE). Results rendered in `explain-viewer.tsx`. ✅
- `EXPLAIN ANALYZE` is correctly treated as executing (backend detects via `explain_safe_to_run` / SELECT-wrapping) and gated. ✅

### 2.3 Query history — ✅ Fully implemented
- Persisted per connection (`persistence.ts` `getQueryHistory`/`addQueryToHistory`, capped at 50, deduped); cleared via `clearQueryHistory`. UI in `query-history.tsx`. ✅

### 2.4 Multi-tab query editor — ✅ Fully implemented
- Workspace tabs of kind `query`; per-tab query text persisted (`setQueryTabContent`), active tab persisted. `transientStore` Map keyed by tabId tracks run state. ✅

### 2.5 Autocomplete — ✅ Fully implemented
- Schema-aware completion provider in `sql-editor.tsx`; verifiable per-connection caches. ✅

---

## 3. Data grid / table viewer

### 3.1 Table data viewing — ✅ Fully implemented
- `DatabaseView.tsx` `fetchData` loads paginated rows via `pg_get_table_data` (COUNT + SELECT, sort/filter/limit/offset). ✅

### 3.2 Row editing — ✅ Fully implemented
- `ResultsViewerCore.tsx` stages edits in `pendingChanges`, commits atomically via `mutate_rows` in a single transaction (backend `pg_mutate`). `handleSaveEdit`, `handleInsertSubmit`, `handleDeleteRow`, `handleApplyAll`. ✅

### 3.3 Insert / delete rows — ✅ Fully implemented
- Row insertion/deletion via the same staged-mutation path. ✅

### 3.4 Transactions — ✅ Fully implemented
- Backend `pg_mutate` wraps multi-statement changes in one transaction, so staged grid edits commit atomically. ✅

### 3.5 Type-specific display & editing — ✅ Fully implemented (mostly)
- Backend `pg_value` converts per type: `int2/4/8`, float, bool, **numeric via binary wire decode** (`numeric_bytes_to_string` — avoids float rounding), `json`/`jsonb`, `bytea` → `\x` hex, `date`/`time`/`timestamp`/`timestamptz`, `_`-prefixed arrays, and enums (via `RawBytes` accepting any OID). ✅
- `field-types.ts` / `row-editor-panel.tsx` provide type-aware editors for common types (text, numeric, boolean, dates, JSON, arrays). 🟡 — Editing is natural for scalar types; complex types mostly edit as text/JSON. Not all types have a dedicated widget.
- The `SqlText` ToSql wrapper sends values as text so Postgres casts to the column type — this is what makes enum/numeric/uuid/date/jsonb writes work. ✅

### 3.6 Pagination — ✅ Fully implemented
- Page-size selector + previous/next in `DatabaseView.tsx`; persisted query-results height and page size. ✅

### 3.7 Column resize & column hide — ✅ Fully implemented
- Column widths persisted per `schema.table` (localStorage `colWidths`), drag-to-resize in `ResultsViewerCore`; column visibility toggle via `columns-popover.tsx`. ✅

### 3.8 Export — ✅ Fully implemented
- CSV (RFC 4180), JSON, and SQL INSERTs. Grid-level export menu + per-table export submenu in `TableList.tsx` (`toCsv`/`toJson`/`toSqlInserts`), rows bounded at 100k via `get_table_data pageSize 100000`, saved through Tauri's `save`/`writeTextFile` dialog. ✅
- `export.ts` `downloadText` (Blob anchor path) exists but the primary flows use the native save dialog; unverified whether `downloadText` is still used anywhere.

### 3.9 Integration with Glide Grid — 🔴 Disabled
- `ResultsViewerCore.tsx` sets `USE_GLIDE_GRID = false`, so the (heavily modified) `glide-data-grid.tsx` canvas grid is **not rendered**; the shadcn `<Table>` is used instead. The Glide component exists and has recent commits but is currently disabled/dead code. 🔴 (see GAPS.md)

---

## 4. Schema browsing

### 4.1 Tables list & expansion — ✅ Fully implemented
- `SchemaExplorer` lists schemas + tables with expand-to-columns, search filter, refresh, and persisted expansion state (`persistence.ts` `getExpandedTables`). ✅

### 4.2 Views & materialized views — ✅ Fully implemented
- `TABLE_LIST_SQL` covers `relkind` `r/v/m/p` (table, view, matview, partitioned); `tableKind()` in `TableList.tsx` renders distinct icons/labels for Materialized view, View, Partitioned table, Table. ✅

### 4.3 Triggers / Functions / RLS policies — ✅ Fully implemented (read-only)
- `TableDetailsPanel.tsx` is a right-hand sheet with three tabs: Triggers (name, enabled state, timing, event, action statement), Functions (language, return type, volatility, SECURITY DEFINER badge), RLS Policies (command badge, roles, USING/CHECK expressions). Backed by `get_triggers`, `get_functions`, `get_rls_policies`. ✅
- Read-only display only — no create/edit/drop of triggers/functions/policies from the UI. 🟡 (see GAPS.md)

### 4.4 Roles / permissions panel — ✅ Fully implemented (read-only)
- `roles-panel.tsx` displays roles (name, superuser, createdb, createrole, login, connection limit, member_of via `pg_auth_members`). Backed by `get_roles`. Read-only — no role creation/grant editing. 🟡 (see GAPS.md)

### 4.5 Schema visualizer — ✅ Fully implemented
- `schema-visualizer/index.tsx` renders an ER-style canvas: auto-layout (topological layering), zoom/pan, table drag, PK/FK markers, relationship edges+arrows, overview minimap, PNG export, reset-layout, lock-toggle, dark-mode-aware theming via MutationObserver, schema selector. Wired as a workspace tab (`DatabaseView.tsx` kind `visualizer`). ✅

### 4.6 Table editor (create / edit table) — 🟡 Partially implemented
- `table-editor.tsx` supports create and edit: add/rename/drop columns, change type, toggle nullable, set default, primary key, drag-drop reorder (dnd-kit), and builds DDL via `buildTableSql`. ✅
- **Foreign keys:** drafts are **create-only** ("UI only for now") — FK management on an *existing* table is not wired to ALTER TABLE. 🟡
- Duplicate table (`CREATE TABLE ... (LIKE ... INCLUDING ALL)`) and copy-schema-DDL are fully implemented in `TableList.tsx`. ✅

---

## 5. Neon branch switching

- `neon-branch-switcher.tsx` lists branches via the Neon Management API v2 client (`neon.rs`: projects/branches/endpoints, `derive_project_id`, `build_branch_uri`); saving the API key through `save_neon_api_key`; selecting a branch disconnects → swaps connection URL → reconnects. Shown only when `connInfo?.isNeon` (`database-navbar.tsx`). ✅ Fully implemented.
- Note: the Neon API key is stored in plaintext (`StoredConnection.neon_api_key`). See GAPS.md.

---

## 6. Performance features

### 6.1 Connection pooling — ✅ Fully implemented
- `deadpool-postgres` pool, `max_size = 8`, per-connection. `connect` builds the pool with a 5s timeout. ✅

### 6.2 Query batching — ✅ Fully implemented
- `TABLE_LIST_SQL` loads tables/views/matviews + RLS flag + row counts in a single batched query. Schema visualizer parallelizes per-table column fetches (`Promise.all`) after the earlier bottleneck removal. ✅

---

## 7. Safety guardrails

- **Safe Mode** — ✅ Fully implemented. `safe-mode-toggle.tsx` toggles; **defaults ON** (`persistence.ts` `getSafeMode` returns true). In Safe Mode, destructive queries require an explicit confirmation dialog (`query-confirmation-dialog.tsx`); off, `confirmDestructive: true` is passed straight through.
- **Backend destructive gate** — ✅ Fully implemented. `commands.rs` `execute_query` returns `DESTRUCTIVE_QUERY_REQUIRES_CONFIRMATION` if `is_destructive(&query) && !options.confirm_destructive`. Includes `do` and `call` in `is_destructive_keyword`.
- **Backend read-only enforcement** — ✅ Fully implemented (see 1.3). Backend is the source of truth.
- **Destructive SQL scanner** — 🟡 Partial. Backend `SqlScanner` does proper top-level statement splitting, WITH-clause traversal, DO/CALL, SELECT..INTO, EXPLAIN ANALYZE detection. **Frontend `destructive-sql.ts` `DESTRUCTIVE_KEYWORDS` omits `do`/`call`** and splits only on `;` — so the *client-side* confirmation dialog won't trigger for DO/CALL, but the backend still rejects those without confirmation. Net effect: client dialog and backend gate are inconsistent for DO/CALL (the backend saves you, but UX is uneven). 🟡
- **Destructive confirmations in the grid/table tooling** — ✅ `confirm-dialog.tsx` used for Empty (TRUNCATE) / Delete (DROP) table, destructive grid actions. Destructive commands pass `confirmDestructive: true`.

---

## 8. Other features

- **Workspace tabs** — ✅ Multi-kind tabs (table/query/create/edit/visualizer) with per-connection persistence and migration from older tab formats (`persistence.ts` `migrateWorkspaceTabs`).
- **Right sidebar / Row Inspector** — ✅ `right-sidebar.tsx` + `right-sidebar-context.tsx`; row editing sheet, table-details sheet live here.
- **Column filters** — ✅ `filter-popover.tsx`; backend `TableFilter` operators (eq/neq/contains/not_contains/like/not_like/starts_with/ends_with/is_null/is_not_null) with parameterized WHERE (`build_filter_where`).
- **Sorting** — ✅ per-column sort.
- **Explain viewer** — ✅ `explain-viewer.tsx` renders JSON plans.
- **Theming / dark mode** — ✅ `theme-toggle.tsx`; visualizer & grid observe the `dark` class.

---

## 9. Feature matrix summary

| Area | Status |
|------|--------|
| Provider detection & badges | 🟡 (metadata icon ignores provider) |
| SSL modes | ✅ (no `verify-ca` UI option) |
| Read-only connections | ✅ |
| Local server detection | ✅ |
| Connection/credential storage | 🟡 (plaintext) |
| Query editor (run/explain/analyze/history/tabs/autocomplete) | ✅ |
| Data grid viewing + edit/insert/delete + transactions + pagination | ✅ |
| Type-specific display/editing (numeric, JSONB, bytea, arrays, enums) | ✅ |
| Export (CSV/JSON/SQL) | ✅ |
| Glide canvas grid | 🔴 disabled (`USE_GLIDE_GRID=false`) |
| Schema browsing (tables/views/matviews) | ✅ |
| Triggers / Functions / RLS panel | ✅ (read-only) |
| Roles panel | ✅ (read-only) |
| Schema visualizer | ✅ |
| Table editor (create/edit) | 🟡 (FK editing not wired) |
| Neon branch switching | ✅ |
| Connection pooling / batching | ✅ |
| Safe Mode + destructive gating | ✅ (client/backend `do`/`call` divergence) |
