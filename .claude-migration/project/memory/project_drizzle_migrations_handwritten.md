---
name: project-drizzle-migrations-handwritten
description: "BuenAdoptante migrations are hand-written SQL; `drizzle-kit generate` is broken/abandoned despite CLAUDE.md listing it"
metadata: 
  node_type: memory
  type: project
  originSessionId: 66eb7fda-6152-4780-91e1-fd5105f5fd1a
---

In BuenAdoptante, D1 migrations are **hand-authored** as `drizzle/NNNN_<name>.sql` files (sequential, comment-rich — see `0042`, `0043`). `wrangler.toml` sets `migrations_dir = "drizzle"` and `wrangler d1 migrations apply` runs the `.sql` files directly.

`drizzle-kit generate` is NOT the workflow even though CLAUDE.md's command list implies it is. The `drizzle/meta/` snapshot folder is abandoned (snapshots stop at `0007`; `_journal.json` references unrelated old tags). Running `drizzle-kit generate` hangs on an interactive rename prompt because the meta snapshot is decades out of sync with the real schema.

**Why:** the team diverged from drizzle-kit's generate flow long ago; `src/db/schema.ts` is kept as the ORM type source only.

**How to apply:** After editing `src/db/schema.ts`, hand-write the next `drizzle/NNNN_*.sql` (additive `ALTER TABLE ... ADD COLUMN`, no UNIQUE on backfilled data — see `0042`'s safety note). Do NOT run `drizzle-kit generate`. Apply locally with `wrangler d1 execute pet-adoption-db --local --command "..."` per [[project_theming]]-adjacent schema-sync workflow; CI's `migrate-*` jobs apply to staging/prod.
