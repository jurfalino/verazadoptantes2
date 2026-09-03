import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Guard: nothing may write to a SQL VIEW.
 *
 * `adoptions` became a view in migration 0056 (the animals/placements
 * normalization). Views here have no `INSTEAD OF` triggers, so SQLite rejects
 * writes outright — `Error: cannot modify adoptions because it is a view` — and
 * the calling server action throws. That shipped as a 500 on owner/admin
 * adopter delete and went unnoticed from 0056 until v2.49.10, because the
 * normalization migrated two delete paths (`deleteAdoption`,
 * `/api/admin/delete-adopter`) and missed a third (`deleteOwnAdopter`).
 *
 * Nothing catches this earlier: it type-checks fine (drizzle sees a table),
 * lints fine, and only fails at runtime against a real database.
 *
 * Views are read from `drizzle/*.sql` rather than hardcoded, so a future
 * table→view conversion is covered automatically.
 *
 * The alias handling is load-bearing: the real bug was written as
 * `const { adoptions: adoptionsTable } = await import('@/db/schema')` and then
 * `db.delete(adoptionsTable)`. A plain search for `delete(adoptions` misses it.
 */

const ROOT = path.resolve(__dirname, '..', '..');

/** View names created by migrations and not later dropped. */
function viewsFromMigrations(): string[] {
    const dir = path.join(ROOT, 'drizzle');
    const created = new Set<string>();
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
        const sql = fs.readFileSync(path.join(dir, file), 'utf8');
        for (const m of sql.matchAll(/CREATE\s+VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?(\w+)/gi)) {
            created.add(m[1]);
        }
        for (const m of sql.matchAll(/DROP\s+VIEW\s+(?:IF\s+EXISTS\s+)?["'`]?(\w+)/gi)) {
            // A migration that drops then recreates still ends up a view; the
            // ordered pass above re-adds it on the CREATE.
            created.delete(m[1]);
        }
        for (const m of sql.matchAll(/CREATE\s+VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?(\w+)/gi)) {
            created.add(m[1]);
        }
    }
    return [...created];
}

function sourceFiles(dir: string, acc: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) sourceFiles(full, acc);
        else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts')) acc.push(full);
    }
    return acc;
}

/** Local identifiers bound to `viewName` in this file, including the view name itself. */
function identifiersFor(src: string, viewName: string): string[] {
    const names = new Set<string>([viewName]);
    // `const { adoptions: adoptionsTable } = ...` and `import { adoptions as x }`
    const alias = new RegExp(`\\b${viewName}\\s*(?::|\\bas\\b)\\s*(\\w+)`, 'g');
    for (const m of src.matchAll(alias)) names.add(m[1]);
    return [...names];
}

describe('no writes to SQL views', () => {
    const views = viewsFromMigrations();

    it('finds the views declared in migrations', () => {
        // Sanity: if this ever empties, the guard below silently passes forever.
        expect(views.length).toBeGreaterThan(0);
        expect(views).toContain('adoptions');
    });

    it('no db.delete / db.update / db.insert targets a view', () => {
        const offenders: string[] = [];

        for (const file of sourceFiles(path.join(ROOT, 'src'))) {
            const src = fs.readFileSync(file, 'utf8');
            for (const view of views) {
                if (!src.includes(view)) continue;
                for (const ident of identifiersFor(src, view)) {
                    const write = new RegExp(`\\.(delete|update|insert)\\s*\\(\\s*${ident}\\s*[),]`, 'g');
                    for (const m of src.matchAll(write)) {
                        const line = src.slice(0, m.index).split('\n').length;
                        offenders.push(
                            `${path.relative(ROOT, file)}:${line} — .${m[1]}(${ident}) writes to view "${view}"`
                        );
                    }
                }
            }
        }

        expect(
            offenders,
            `Writes to a SQL view will fail at runtime with "cannot modify <view> because it is a view".\n` +
            `Target the underlying tables instead (see deleteAdopterRecords / deleteRecordById).\n\n` +
            offenders.join('\n')
        ).toEqual([]);
    });

    it('raw SQL does not write to a view either', () => {
        const offenders: string[] = [];
        const dirs = ['src', 'scripts'].map(d => path.join(ROOT, d)).filter(fs.existsSync);

        for (const dir of dirs) {
            for (const file of sourceFiles(dir)) {
                const src = fs.readFileSync(file, 'utf8');
                for (const view of views) {
                    const raw = new RegExp(`(DELETE\\s+FROM|UPDATE|INSERT\\s+INTO)\\s+["'\`]?${view}\\b`, 'gi');
                    for (const m of src.matchAll(raw)) {
                        const line = src.slice(0, m.index).split('\n').length;
                        offenders.push(`${path.relative(ROOT, file)}:${line} — raw ${m[1]} on view "${view}"`);
                    }
                }
            }
        }

        expect(offenders, offenders.join('\n')).toEqual([]);
    });
});
