#!/usr/bin/env python3
"""
Bring the local dev/test SQLite databases up to date with drizzle/*.sql.

Why this exists alongside `scripts/setup-test-db.js`: that script needs
`better-sqlite3`, whose native addon does not build on Node 26 (node-gyp fails
against the v147 ABI). Python ships sqlite3 in the stdlib, so this works
regardless of the Node version and needs no toolchain.

Targets BOTH local databases, which is a real footgun in this repo:
  - `local.db`                       -> what `next dev` reads (src/lib/db.ts:28)
  - `.wrangler/state/.../*.sqlite`   -> what `wrangler d1 --local` reads

They drift independently, so a schema fix applied to only one leaves the other
broken in a way that looks like an application bug.

Idempotent: "already exists" / "duplicate column" are expected and skipped.

Usage:  python3 scripts/sync-local-db.py [--seed]
"""
import os
import re
import sqlite3
import sys
import glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

BENIGN = ('already exists', 'duplicate column')


def statements_from(path):
    sql = open(path, encoding='utf-8').read()
    # Strip comments (including drizzle's `--> statement-breakpoint` markers),
    # then split on ';'. A chunk between breakpoints can itself hold several
    # statements (CREATE TABLE + its indexes), and sqlite3 executes one at a
    # time — so ';' is the only reliable delimiter here.
    sql = re.sub(r'^\s*--.*$', '', sql, flags=re.M)
    return [s.strip() for s in sql.split(';') if s.strip()]


def targets():
    found = [os.path.join(ROOT, 'local.db')]
    found += glob.glob(os.path.join(ROOT, '.wrangler', 'state', 'v3', 'd1', '**', '*.sqlite'), recursive=True)
    return [p for p in found if os.path.exists(p)]


def apply(db_path, files, label):
    con = sqlite3.connect(db_path, timeout=15)
    applied = skipped = failed = 0
    for f in files:
        for stmt in statements_from(f):
            try:
                con.execute(stmt)
                applied += 1
            except sqlite3.Error as e:
                if any(b in str(e).lower() for b in BENIGN):
                    skipped += 1
                else:
                    failed += 1
                    print(f'  ! {os.path.basename(f)}: {e}')
    con.commit()
    con.close()
    print(f'  {label}: {applied} applied, {skipped} already present, {failed} failed')
    return failed


def main():
    migrations = sorted(glob.glob(os.path.join(ROOT, 'drizzle', '*.sql')))
    if not migrations:
        sys.exit('no migrations found in drizzle/')

    dbs = targets()
    if not dbs:
        sys.exit('no local databases found — run `npm run dev` once first')

    print(f'{len(migrations)} migrations -> {len(dbs)} database(s)')
    total_failed = 0
    for db in dbs:
        print(f'\n{os.path.relpath(db, ROOT)}')
        total_failed += apply(db, migrations, 'schema')
        if '--seed' in sys.argv:
            seed = os.path.join(ROOT, 'tests', 'seed.sql')
            if os.path.exists(seed):
                total_failed += apply(db, [seed], 'seed')

    print('\nDone.' if not total_failed else f'\nDone with {total_failed} real failure(s) above.')
    return 1 if total_failed else 0


if __name__ == '__main__':
    sys.exit(main())
