---
name: readonly-queries-pre-authorized
description: "Read-only queries (SELECT, COUNT, schema inspection) against prod or staging D1 don't need re-authorization once the user has approved the broader task. Stop pausing for permission on every additional read."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 66eb7fda-6152-4780-91e1-fd5105f5fd1a
---

When investigating, don't pause to ask for authorization on additional
read-only queries against the production D1 database. The user explicitly
said "no need to ask for authorization for read queries" (2026-05-28). Apply
the same to staging.

**Why:** Pausing repeatedly during a single investigation thread breaks
momentum and adds round-trips that the user has already given blanket
approval for. The auto-mode classifier sometimes blocks individual prod
queries even after the user authorized the parent task; when that happens,
treat the user's prior "go ahead" as standing approval and either rerun
once the classifier clears or report what was blocked and propose
re-running.

**How to apply:**
- `SELECT … FROM …` and `PRAGMA …` against either D1 instance: go.
- Schema inspection (`d1_migrations` table, `sqlite_master`): go.
- Anything destructive (INSERT, UPDATE, DELETE, DROP, ALTER, migrations
  applied) still requires explicit approval each time, naming the prod
  target if that's where it'll run.
- Related: write actions still gated. This memory ONLY covers reads.
