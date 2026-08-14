# What Was Done

A summary of the work completed on the Relic (Tauri Postgres GUI) project. Written for a general audience — no deep code internals.

## Overview

The app is a desktop tool for working with PostgreSQL databases (including Neon and Supabase). This session's work made it genuinely useful and safe to use: 12 planned improvements were implemented, verified, and merged, plus a final connection bug was fixed on the day of release.

## New features

### Connections
- **SSL now actually works.** Before, the app silently ignored the SSL setting in a connection URL, so connecting to Neon/Supabase (which require SSL) failed. Now all SSL modes are supported (`disable`, `prefer`, `require`, `verify-ca`, `verify-full`).
- **Read-only connections.** You can mark a connection as read-only, and the app blocks any query that would change data.
- **Provider badges.** Neon, Supabase, and plain PostgreSQL connections show distinct colored badges so you can tell them apart at a glance.
- **Connection storage fixed.** Connections used to be saved in two places at once (browser storage and a file), which made them drift apart. Now there's a single source of truth, and all management (add/edit/delete) happens in one place.

### Query editor
- **Query history.** The queries you run are saved per connection (up to 50), and you can restore any of them with a click.
- **Auto-complete.** While typing SQL, the editor suggests table and column names from your actual database, plus SQL keywords.
- **EXPLAIN visualization.** A button runs the database's query planner and shows a readable, collapsible tree of how the query would execute (with a toggle to actually run it and see real timings).

### Data grid (table viewer)
- **Insert rows.** A dialog lets you add a new row; the database fills in defaults.
- **Delete rows.** Select rows and delete them with a confirmation dialog.
- **Safe editing.** Editing a cell no longer builds SQL by hand-pasting text into the query (which was fragile and could corrupt data). All edits use proper parameters.
- **Apply changes atomically.** All your staged edits, inserts, and deletes are sent as one transaction — they either all succeed or all fail together.
- **Export.** Copy results as JSON, or download them as CSV or JSON files.
- **Safe display of tricky data.** Arrays, binary data, and large decimal numbers used to show up as empty/null. Now they display correctly.

### Database browsing
- **Views & more.** The schema sidebar now shows views and materialized views separately from tables, with estimated row counts.
- **Table details panel.** Right-click a table to see its triggers, functions, and Row-Level-Security policies (important for Supabase).
- **Roles panel.** A button lists database roles with their permissions (superuser, can create databases, can log in, membership).
- **Neon branch switcher.** If you use Neon, the app can list your database branches and switch between them (enter your Neon API key once).

## Performance & reliability improvements

- **Faster table listing.** Listing tables used to run a separate count query per table (slow on big databases). Now it's a single query.
- **Connection pooling.** The app reuses database connections instead of opening a new one for every query, which is faster and lighter on the server.
- **Correct pagination.** The table viewer now shows the real total row count and correct page numbers (previously it always looked like one page).
- **Provider detection.** Supabase is now detected not just by its domain name but also by the presence of its actual schemas, so connections are labeled correctly.
- **Lower memory usage.** The app no longer keeps every connection open for the lifetime of the session; connections are checked out only while a query runs.

## Safety guardrails

- **Destructive-query confirmation.** Dangerous statements (DROP, DELETE, TRUNCATE, ALTER, etc.) require an explicit confirmation before running.
- **Read-only enforced on the server side.** Even if the UI were bypassed, a read-only connection cannot run writes — the app itself rejects them.
- **Closed a data-safety hole.** Certain write commands wrapped in other SQL could slip past the guardrails; those are now blocked too.
- **Safer for pooled endpoints.** Connections through Supabase/Neon poolers show a note that some features (like EXPLAIN) may not work there.

## What was fixed on release day

- A user's Neon connection string that included `?sslmode=require` was stored with an **empty** SSL value (`?sslmode=`), which made the app reject the connection with "Unsupported sslmode". The fix makes the app treat an empty/blank SSL setting as the default (`prefer`) instead of failing, and the affected saved connection was corrected. This is a robustness fix so this class of problem can't happen again.

## How it was verified

- 110 automated backend tests (Rust) and 19 frontend tests — all passing.
- Type checks and production builds pass cleanly.
- Every task went through a code-review gate as it was built.

## Note for future work

- Live smoke tests against a real database (and a real Neon API key) are still recommended before shipping, since automated tests can't exercise a live server.
