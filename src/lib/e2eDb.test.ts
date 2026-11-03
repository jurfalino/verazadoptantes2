import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'fs';

vi.mock('child_process', () => ({ execSync: vi.fn() }));
import { execSync } from 'child_process';
// The real e2e helper (tests/db.ts) — only child_process is mocked.
import { execD1, execD1Batch, rows } from '../../tests/db';

const mocked = vi.mocked(execSync);
beforeEach(() => { mocked.mockReset(); });

describe('execD1Batch', () => {
    it('runs 3 statements in exactly one wrangler call using --file', () => {
        let sqlFile = '';
        let contents = '';
        mocked.mockImplementation(((cmd: string) => {
            sqlFile = /--file="([^"]+)"/.exec(cmd)![1];
            contents = readFileSync(sqlFile, 'utf8');
            return '[]';
        }) as never);
        execD1Batch(["DELETE FROM a WHERE id='x'", 'DELETE FROM b;', "INSERT INTO c VALUES ('it''s;')"]);
        expect(mocked).toHaveBeenCalledTimes(1);
        const cmd = String(mocked.mock.calls[0][0]);
        expect(cmd).toContain('wrangler d1 execute DB --local --file=');
        expect(cmd).toContain('--json');
        expect(cmd).not.toContain('--command');
        expect(contents).toBe("DELETE FROM a WHERE id='x';\nDELETE FROM b;\nINSERT INTO c VALUES ('it''s;');\n");
        expect(existsSync(sqlFile)).toBe(false); // temp file cleaned up
    });

    it('throws with wrangler stderr/stdout, names the batch, and cleans up when the call fails', () => {
        let sqlFile = '';
        mocked.mockImplementation(((cmd: string) => {
            sqlFile = /--file="([^"]+)"/.exec(cmd)![1];
            throw Object.assign(new Error('Command failed'), { stderr: 'boom: no such table', stdout: '{"error":{"text":"no such table: zz"}}' });
        }) as never);
        expect(() => execD1Batch(['DELETE FROM ok', 'DELETE FROM zz'])).toThrow(/boom: no such table[\s\S]*no such table: zz/);
        expect(() => execD1Batch(['DELETE FROM ok', 'DELETE FROM zz'])).toThrow(/batch of 2 statements failed \(none applied[^)]*\)\. First: DELETE FROM ok \| Last: DELETE FROM zz/);
        expect(existsSync(sqlFile)).toBe(false);
    });

    it('makes no call for an empty batch', () => {
        execD1Batch([]);
        expect(mocked).not.toHaveBeenCalled();
    });
});

describe('rows / execD1', () => {
    it('returns the result rows', () => {
        mocked.mockReturnValue('[{"results":[{"id":"a"}],"success":true}]' as never);
        expect(rows('SELECT id FROM t')).toEqual([{ id: 'a' }]);
    });

    it('throws (never returns []) when the query fails, with the SQL head and stderr', () => {
        mocked.mockImplementation((() => { throw Object.assign(new Error('x'), { stderr: 'no such table: t' }); }) as never);
        expect(() => rows('SELECT id FROM t')).toThrow(/SELECT id FROM t[\s\S]*no such table: t/);
    });

    it('throws on unparseable output instead of returning []', () => {
        mocked.mockReturnValue('not json' as never);
        expect(() => rows('SELECT 1')).toThrow(/unparseable/);
    });

    it('execD1 escapes double quotes in the --command', () => {
        mocked.mockReturnValue('[]' as never);
        execD1('SELECT "a"');
        expect(String(mocked.mock.calls[0][0])).toContain('--command="SELECT \\"a\\""');
    });

    it('throws (never returns []) on output with no result set, e.g. a non-SELECT', () => {
        mocked.mockReturnValue('{"success":true}' as never);
        expect(() => rows('DELETE FROM t')).toThrow(/no result set/);
    });
});

describe('SQLITE_BUSY retry', () => {
    const wait = vi.spyOn(Atomics, 'wait').mockImplementation(() => 'ok');
    beforeEach(() => { wait.mockClear(); });
    afterEach(() => { wait.mockClear(); });
    const busy = () => Object.assign(new Error('x'), { stderr: 'SQLITE_BUSY: database is locked' });

    it('retries once when the first call is busy, then returns the result', () => {
        mocked.mockImplementationOnce((() => { throw busy(); }) as never).mockReturnValueOnce('[{"results":[]}]' as never);
        expect(execD1('SELECT 1')).toBe('[{"results":[]}]');
        expect(mocked).toHaveBeenCalledTimes(2);
        expect(wait).toHaveBeenCalledTimes(1);
    });

    it('gives up after 6 tries when always busy and throws', () => {
        mocked.mockImplementation((() => { throw busy(); }) as never);
        expect(() => execD1('SELECT 1')).toThrow(/database is locked/);
        expect(mocked).toHaveBeenCalledTimes(6);
        expect(wait).toHaveBeenCalledTimes(5);
    });

    it('does not retry a non-busy error', () => {
        mocked.mockImplementation((() => { throw Object.assign(new Error('x'), { stderr: 'no such table' }); }) as never);
        expect(() => execD1('SELECT 1')).toThrow(/no such table/);
        expect(mocked).toHaveBeenCalledTimes(1);
    });
});
