/**
 * The pins are read and written on the person's EXISTING profile row(s), never
 * a new one: an email with two user rows (the e2e seed has one) must not get a
 * terms-less profile created for the other row (v2.58.48 CI: the terms prompt
 * then blocked every page, and the pins landed on the wrong row).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { getAdopterListPinsForEmail, setAdopterListPinsForEmail } from './adopterListPins';

let sqlite: Database.Database;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the same Db union getDb() returns
let db: any;

beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(`
        CREATE TABLE user (id TEXT PRIMARY KEY, email TEXT, name TEXT);
        CREATE TABLE user_profiles (user_id TEXT PRIMARY KEY, adopter_list_pins TEXT, terms_version INTEGER);
        INSERT INTO user (id, email) VALUES ('main', 'admin@example.com'), ('dup', 'ADMIN@example.com'), ('other', 'x@example.com');
        INSERT INTO user_profiles (user_id, terms_version) VALUES ('main', 1), ('other', 1);
    `);
    db = drizzle(sqlite);
});

const profileRows = () => sqlite.prepare('SELECT user_id, adopter_list_pins FROM user_profiles ORDER BY user_id').all();

describe('adopter list pins storage', () => {
    it('no saved pins: the defaults', async () => {
        expect(await getAdopterListPinsForEmail(db, 'admin@example.com')).toEqual(['src:form', 'src:post']);
    });

    it('saves on the existing profile row only — never creates one for the duplicate user row', async () => {
        await setAdopterListPinsForEmail(db, 'Admin@Example.com ', ['rating:1']);
        expect(profileRows()).toEqual([
            { user_id: 'main', adopter_list_pins: '["rating:1"]' },
            { user_id: 'other', adopter_list_pins: null },
        ]);
        expect(await getAdopterListPinsForEmail(db, 'admin@example.com')).toEqual(['rating:1']);
    });

    it('an empty list is kept (everything unpinned), not read back as the defaults', async () => {
        await setAdopterListPinsForEmail(db, 'admin@example.com', []);
        expect(await getAdopterListPinsForEmail(db, 'admin@example.com')).toEqual([]);
    });

    it('no profile row at all: refused, nothing written', async () => {
        await expect(setAdopterListPinsForEmail(db, 'nobody@example.com', ['rating:1'])).rejects.toThrow(/No profile row/);
        expect(profileRows()).toHaveLength(2);
    });
});
