import { execSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * The one test-DB helper every e2e spec imports (replaces ~34 private copies).
 *
 * Each `wrangler d1 execute` spawn costs ~1.1 s, so anything that runs more than
 * one statement goes through `execD1Batch` (one spawn, one transaction).
 * Failures always throw — a query that failed must never look like "no rows".
 */

const sqlHead = (sql: string) => sql.replace(/\s+/g, ' ').trim().slice(0, 80);

function failure(what: string, e: unknown): Error {
    const err = e as { stderr?: unknown; stdout?: unknown; message?: string };
    // wrangler prints its JSON error ({"error":{"text":…}}) on stdout and noise on stderr — keep both.
    const detail = [String(err.stderr ?? '').trim(), String(err.stdout ?? '').trim()].filter(Boolean).join('\n') || err.message || String(e);
    return new Error(`${what}\n${detail}`);
}

const isBusy = (e: unknown) => /SQLITE_BUSY|database is locked/.test(String((e as { stderr?: unknown }).stderr ?? '') + String((e as { stdout?: unknown }).stdout ?? '') + String(e));

/**
 * The dev server may hold the local DB's write lock (a notification written after
 * a response): SQLITE_BUSY is "try again", not a failure. Anything else throws.
 */
function run(command: string, what: string): string {
    for (let attempt = 1; ; attempt++) {
        try {
            return execSync(command, { cwd: process.cwd(), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
        } catch (e) {
            if (!isBusy(e) || attempt >= 6) throw failure(what, e);
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500 * attempt);
        }
    }
}

/** One statement → wrangler's raw `--json` output. Throws (with the SQL's head and wrangler's output) on failure. */
export function execD1(sql: string): string {
    return run(
        `npx wrangler d1 execute DB --local --command="${sql.replace(/"/g, '\\"')}" --json`,
        `D1 statement failed: ${sqlHead(sql)}`,
    );
}

/** wrangler `--json` output → rows. Throws on unparseable output or a missing result set; never returns [] for an error. */
export function parseD1Rows(output: string, sqlHint = ''): Array<Record<string, unknown>> {
    let results: unknown;
    try {
        const wrapped = JSON.parse(output);
        results = (Array.isArray(wrapped) ? wrapped[0] : wrapped)?.results;
    } catch {
        throw new Error(`D1 query returned unparseable output: ${sqlHead(sqlHint)}\n${output.slice(0, 300)}`);
    }
    if (!Array.isArray(results)) throw new Error(`D1 query returned no result set: ${sqlHead(sqlHint)}`);
    return results as Array<Record<string, unknown>>;
}

/** A SELECT → its rows. Throws on a failed query or an unreadable result; never returns [] for an error. */
export function rows(sql: string): Array<Record<string, unknown>> {
    return parseD1Rows(execD1(sql), sql);
}

/**
 * Many statements, one wrangler spawn (`--file`, executed as a single transaction:
 * if one statement fails nothing is applied and this throws). Empty → no call.
 */
export function execD1Batch(statements: string[]): void {
    if (statements.length === 0) return;
    const dir = mkdtempSync(join(tmpdir(), 'e2e-d1-'));
    const file = join(dir, 'batch.sql');
    try {
        writeFileSync(file, statements.map(s => s.trim().replace(/;+\s*$/, '') + ';').join('\n') + '\n');
        run(
            `npx wrangler d1 execute DB --local --file="${file}" --json`,
            `D1 batch of ${statements.length} statements failed (none applied). First: ${sqlHead(statements[0])}`,
        );
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

/** Wrangler's --json renders SQL NULL as the string "null" in CI — normalize. */
export const isDbNull = (v: unknown) => v === null || v === undefined || v === 'null';
export const sqlJson = (v: unknown) => JSON.stringify(v).replace(/'/g, "''");
