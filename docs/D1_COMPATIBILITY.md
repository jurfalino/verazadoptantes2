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
