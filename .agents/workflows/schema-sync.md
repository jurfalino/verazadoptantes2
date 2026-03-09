---
description: Verify and sync local D1 database schema with Drizzle schema definitions. Run after any schema change.
---

# Local DB Schema Sync

> **Run this after modifying `src/db/schema.ts` or when local data seems broken.**

## Quick Audit — Compare Drizzle schema vs local DB

// turbo
1. List all tables in Drizzle schema:
```
node -e "const s=require('./src/db/schema');console.log(Object.entries(s).filter(([_,v])=>v?._.columns).map(([n,v])=>`${n} -> ${v._.name}`).join('\n'))"
```

// turbo
2. List all tables in local DB:
```
npx wrangler d1 execute pet-adoption-db --local --command="SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'd1_%' AND name NOT LIKE 'sqlite_%' ORDER BY name;"
```

3. For each table that exists in both, compare columns:
// turbo
```
npx wrangler d1 execute pet-adoption-db --local --command="PRAGMA table_info(<table_name>);"
```
Compare the output with the Drizzle schema definition in `src/db/schema.ts`.

## Fix Missing Columns

If a column exists in Drizzle but not in the local DB:
```
npx wrangler d1 execute pet-adoption-db --local --command="ALTER TABLE <table> ADD COLUMN <column> <type>;"
```

## Fix Missing Indexes

```
npx wrangler d1 execute pet-adoption-db --local --command="CREATE INDEX IF NOT EXISTS <index_name> ON <table>(<columns>);"
```

## Nuclear Option — Recreate Table

If the table is fundamentally broken:
```
npx wrangler d1 execute pet-adoption-db --local --command="DROP TABLE IF EXISTS <table>;"
```
Then recreate it with the full CREATE TABLE statement from the Drizzle schema.

> ⚠️ **WARNING**: This deletes all local data in that table.
