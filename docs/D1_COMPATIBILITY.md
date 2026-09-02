# D1 Database Compatibility Guide

## Overview
This project uses Cloudflare D1 (SQLite) in production and better-sqlite3 locally. D1 has some important limitations that differ from standard SQL/PostgreSQL.

## Critical Limitations

### ❌ Array Parameters in `IN` Clauses
**D1 does NOT properly handle array parameters in `IN` clauses.**

```typescript
// ❌ BROKEN - D1 generates "IN (?)" with single placeholder
db.select().from(table).where(inArray(table.id, arrayOfIds))

// ❌ BROKEN - Same issue with raw SQL template
db.select().from(table).where(sql`id IN ${arrayOfIds}`)

// ✅ WORKS - Use eq() with single values
db.select().from(table).where(eq(table.id, singleId))

// ✅ WORKS - Loop with parallel Promise.all
await Promise.all(ids.map(id => 
    db.select().from(table).where(eq(table.id, id))
))
```

### Why This Happens
D1's prepared statement handling doesn't expand arrays. When you pass `[id1, id2, id3]`, it becomes `IN (?)` with a single bound value instead of `IN (?, ?, ?)` with three values.

### ❌ More Than 100 Bound Parameters In One Query

**D1 rejects any query binding more than 100 parameters.** This bites hardest on
multi-row inserts, where the count is `rows × columns` and scales with data you
don't control.

```typescript
// ❌ BREAKS once `tokens` exceeds 25 (4 columns × 26 rows = 104 bindings)
await db.insert(duplicateTokens).values(tokens.map(t => ({
    id: crypto.randomUUID(), adopterId, tokenType: t.type, tokenValue: t.value,
})));

// ✅ CORRECT — chunk so each statement stays under the cap
const CHUNK = 20; // 20 × 4 = 80 bindings, with margin
for (let i = 0; i < tokens.length; i += CHUNK) {
    await db.insert(duplicateTokens).values(
        tokens.slice(i, i + CHUNK).map(t => ({ /* ... */ })),
    );
}
```

Multi-row inserts are still worth doing — one statement per 20 rows beats one per
row against the Worker subrequest ceiling. Just size the chunk as
`floor(100 / columnCount)` with margin, not by how many rows you expect.

**How this failed in practice (v2.49.4 → v2.49.6):** the duplicate Scan inserted
every token for a profile in one statement. It worked for ~1,200 records and then
died on one whose notes tokenize into 20+ `name_word` entries — 27 rows × 4 = 108
bindings. Two traps worth avoiding:

- **Don't size the chunk from existing row counts.** The maximum in
  `duplicate_tokens` was 26, but those rows came from the *previous* tokenizer
  version; the new one emitted 27. Size from the parameter cap, not from data.
- **Fixture sets hide this.** The 78-record local fixtures contain no profile
  verbose enough to trigger it. Only production-shaped data does.

Symptom: `Failed query: insert into "…" values (?, ?, …), (?, ?, …), …` with a
long `params:` list. Count the `?` — over 100 is your answer.

## Performance Patterns

### Parallel Queries Per Record
When you need to fetch related data for multiple records:

```typescript
// ✅ OPTIMAL - All records + their queries in parallel
await Promise.all(records.map(async (record) => {
    const [related1, related2, related3] = await Promise.all([
        db.select().from(table1).where(eq(table1.parentId, record.id)),
        db.select().from(table2).where(eq(table2.parentId, record.id)),
        db.select().from(table3).where(eq(table3.parentId, record.id))
    ]);
    // Process results...
}));
```

### Error Handling in Parallel Queries
Use `.catch()` inline to prevent one failing query from breaking everything:

```typescript
const [data1, data2] = await Promise.all([
    db.select().from(table1).where(eq(table1.id, id)).catch(() => []),
    db.select().from(table2).where(eq(table2.id, id)).catch(() => [])
]);
```

## Testing D1 Compatibility

### Debug Endpoints
The project includes debug endpoints for diagnosing D1 issues:
- `/api/debug` - Check D1 connection status
- `/api/debug-search?q=term` - Test direct DB queries
- `/api/debug-action?q=term` - Test Server Actions with DB

### Local Testing with Wrangler
To test D1 locally (simulates production environment):
```bash
npx wrangler pages dev .vercel/output/static --d1 DB=your-database-id
```

## Edge Runtime Requirements

All routes that use D1 must have:
```typescript
export const runtime = 'edge';
```

This is required for Cloudflare Pages deployment.

## Common Error Messages

| Error | Cause | Solution |
|-------|-------|----------|
| `Failed query: ... IN (?) params: id1` | Array parameter in IN clause | Use `eq()` with loop |
| `getRequestContext failed` | Not in Edge runtime | Add `export const runtime = 'edge'` |
| `process.cwd is not a function` | Using Node.js code in Edge | Ensure no `better-sqlite3` in production code |

## Checklist for New Database Queries

- [ ] Does query use `inArray()`? → Replace with `eq()` loop
- [ ] Does query use `sql\`IN ${array}\``? → Replace with `eq()` loop  
- [ ] Is the route marked with `runtime = 'edge'`?
- [ ] Is error handling in place for parallel queries?
- [ ] Has it been tested on Cloudflare (not just locally)?
