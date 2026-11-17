# Relic — Gaps, Broken Items, and Incomplete Features

Each gap is rated by severity and includes **what's missing**, **why it matters**, and roughly **how invasive a fix is** given the current architecture.

Severity legend:
- **Critical** — data loss/corruption, or a broken core workflow (connect/query/edit).
- **High** — a documented/expected feature missing or not working as intended.
- **Medium** — rough edges, inconsistent behavior, partial implementations.
- **Low** — polish, nice-to-haves, missing edge-case handling.

---

## Critical

### C1. Connections and credentials stored in plaintext
- **What:** `StoredConnection` stores connection passwords and the Neon API key (`neon_api_key: Option<String>`) as plaintext in `connections.json`. Local-server passwords are stored plaintext in localStorage (`persistence.ts` `setServerPassword`). No OS keychain, no encryption-at-rest.
- **Why:** If `connections.json` or the webview is compromised, database credentials and the Neon API key are exposed directly. The Neon API key additionally grants management access to a user's Neon projects/branches/endpoints.
- **Fix size:** **Large.** Would require a Rust-side credential store (e.g. `keyring` crate or OS keychain integration), migration of existing stored connections, and rework of `connect`/`save_neon_api_key`/local-password read-write paths. Storage shape is centralized, so it's tractable but touches the security boundary.

---

## High

### H1. Glide Grid is disabled despite being heavily modified
- **What:** `ResultsViewerCore.tsx` has `const USE_GLIDE_GRID = false`, so `src/components/data-grid/glide-data-grid.tsx` (which has recent commits and bug fixes — boolean normalization, staged-highlight, dedup, restore checkboxes) is never rendered; the shadcn `<Table>` is the live data grid. The Glide component and its `editing.ts` helpers are effectively dead code.
- **Why:** A significant amount of work lives in a component users never see. Either the flag was flipped off because the Glide path regressed, or it's an intentional revert; either way the app ships a different grid than the one being maintained. Duplicated maintenance surface and confusion about which grid is live.
- **Fix size:** **Medium.** Either (a) delete/archive `glide-data-grid.tsx` and `editing.ts` if the shadcn grid is the intended long-term choice, or (b) flip the flag to true and re-verify the Glide grid end-to-end (resize, editing, staging, checkboxes). If the switch to shadcn was deliberate, the Glide code should be removed to avoid rot.

### H2. Foreign-key editing on existing tables is not wired
- **What:** `table-editor.tsx` supports creating FK drafts on a **new** table, but FK management on an **existing** table is marked "UI only for now" — no ALTER TABLE ADD/DROP CONSTRAINT for FKs.
- **Why:** Editing or adding foreign keys is a core schema-editing operation users expect from a table editor. Currently they'd have to hand-write SQL.
- **Fix size:** **Medium.** The table editor already generates ALTER TABLE for other column operations; adding an add/drop-constraint path (catalog reads for existing FKs + `buildTableSql` for ALTER) is a moderate addition.

### H3. Roles & permissions are read-only
- **What:** `roles-panel.tsx` displays roles and memberships but offers no create role / alter role / grant / revoke.
- **Why:** For an admin-oriented GUI, the ability to manage roles and grants is an expected feature. Today it's a viewer only.
- **Fix size:** **Medium–Large.** New backend commands (`CREATE/ALTER/DROP ROLE`, `GRANT/REVOKE`) plus form UI and safe confirmations.

### H4. No create/edit/drop for triggers, functions, or RLS policies
- **What:** `TableDetailsPanel.tsx` is display-only for triggers, functions, and RLS policies.
- **Why:** Users can inspect but not manage these objects — a common DBA task.
- **Fix size:** **Large.** Multiple new DDL flows (CREATE/ALTER/DROP TRIGGER, CREATE OR REPLACE FUNCTION, CREATE POLICY / ALTER / DROP) plus editor UI for each.

---

## Medium

### M1. Client-side destructive-keyword list diverges from backend
- **What:** Backend `is_destructive_keyword` includes **`do` and `call`** (plus drop/delete/truncate/update/alter/create/grant/revoke/vacuum/reindex and `SELECT ... INTO`); frontend `src/lib/destructive-sql.ts` `DESTRUCTIVE_KEYWORDS` omits `do`/`call` and splits only on `;`.
- **Why:** A `DO`/`CALL` block that performs writes won't trigger the client Safe-Mode confirmation dialog. The backend still returns `DESTRUCTIVE_QUERY_REQUIRES_CONFIRMATION`, so data is *protected*, but the UX is inconsistent — the dialog the user expects (per backend semantics) may not appear, or they get a confusing backend error they thought Safe Mode should have intercepted.
- **Fix size:** **Small.** Add `"do"` and `"call"` to the frontend keyword list and improve the splitter to skip strings/comments (or reuse a shared scanner).

### M2. Provider metadata returns PostgreSQL for every provider
- **What:** `src/lib/db/providers.ts` `getProviderMetadata` ignores its provider argument and only knows PostgreSQL; `main-layout.tsx` `ProviderIcon` (and database-navbar) use `getProviderMetadata(provider)` for the mini icon.
- **Why:** The sidebar/connection-switcher icon renders a generic PostgreSQL glyph even for Neon/Supabase connections, while the chips elsewhere (which use hardcoded per-provider colors) look correct. Inconsistent branding.
- **Fix size:** **Small.** Populate neon/supabase entries in `providers.ts` (or fall back to the hardcoded `PROVIDER_BADGES` colors) and make `getProviderMetadata` honor its argument.

### M3. No `verify-ca` option in the SSL UI
- **What:** `AddConnectionForm.tsx` offers `["disable","prefer","require","verify-full"]`; backend supports `verify-ca` in `build_tls`, but the UI can't select it.
- **Why:** `verify-ca` (verify the server cert against the CA but not the hostname) is a legitimate TLS stance that some setups require. Users who need it must edit the connection JSON directly or use `require`/`verify-full`.
- **Fix size:** **Small.** Add `"verify-ca"` to the UI list (backend already handles it).

### M4. Complex type editing is mainly free-text
- **What:** `field-types.ts`/`row-editor-panel.tsx` give real editing widgets for scalar types; arrays, JSONB, and other composite types are largely edited as text/JSON strings rather than dedicated UI.
- **Why:** Works functionally (the universal `SqlText` binder casts text), but editing a JSONB object or array as a single string is error-prone and discourages use.
- **Fix size:** **Medium.** Add structured editors (property table for JSONB, comma/tag list for arrays) per type.

### M5. Row export cap at 100k with no incremental/streaming path
- **What:** `TableList.tsx` `exportData` fetches `pageSize: 100000` in one call; anything larger is silently truncated to the first 100k rows without warning, and large fetches can be heavy.
- **Why:** Exporting a large table yields an incomplete file that "succeeds" (user believes they got everything). No streaming or chunked export.
- **Fix size:** **Medium.** Chunked server-side fetch-and-append, or a warning + explicit confirmation when row count exceeds the cap.

---

## Low

### L1. `verify-ca` semantics vs. `require` cert validation
- **What:** `require`/`prefer` disable certificate validation entirely (`danger_accept_invalid_certs(true)`). This is the standard Postgres `sslmode=require` behavior (encrypt but don't verify), so it's arguably correct — noted only for awareness, not a bug.

### L2. (No longer a gap — withdrawn)
- The original note claimed `downloadText` in `src/lib/export.ts` was unused. On re-check, it **is** used by `ResultsViewerCore.tsx:578,582` for the grid's CSV/JSON export (Blob + anchor download path). Not a gap; withdrawn.

### L3. Local password storage in webview localStorage
- **What:** Saved local-server passwords persist as plaintext in `localStorage` (same class of concern as C1 but narrower/smaller blast radius). Tied to C1.

### L4. Query history capped at 50 with no pinning
- **What:** History is a plain list, deduped, capped at 50, no favorites/pinning, no timestamp display.
- **Why:** Nicety for power users; current behavior is functional.
- **Fix size:** **Small.**

### L5. Some column types render without type-specific formatting
- **What:** Unknown/complex types fall back to string representation; `bytea` renders as `\x` hex (correct but not human-friendly), timestamps use raw wire values.
- **Why:** Mostly fine; polish for edge types (e.g. readable blob preview, interval/timezone formatting).
- **Fix size:** **Medium** for full coverage, **small** per type.

---

## Summary of most important work

1. **C1 (plaintext credentials)** is the only Critical finding — prioritize credential at-rest protection.
2. **H1 (dead Glide grid)** is the biggest *discrepancy* — the app maintains a grid nobody renders. Decide the canonical grid and remove/re-enable accordingly.
3. **H2–H4** are the main feature gaps around schema/security object management (FKs, roles, triggers/functions/RLS) — all read-only today.
4. The **M1 destructive-keyword divergence** is a small but real safety/UX inconsistency worth aligning.
