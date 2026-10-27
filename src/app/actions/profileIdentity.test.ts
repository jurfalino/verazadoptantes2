/**
 * Households as profiles, Task 3 — any profile's name and age, open to anyone
 * signed in; minors get no records, alerts or ratings. Real SQL (every
 * drizzle/*.sql replayed), the real token index and duplicate search, the real
 * record writer; the session is the only source of the actor.
 * OWNER (team: MATE) owns Pedro; STRANGER owns nothing here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import * as mocks from '@/test-utils/actionMocks';

const { session, OWNER, MATE, STRANGER, ADMIN } = mocks;

const { state, notify } = vi.hoisted(() => ({
    state: { db: null as unknown, sqlite: null as unknown },
    notify: { create: [] as Array<Record<string, unknown>>, admins: [] as Array<Record<string, unknown>> },
}));

vi.mock('./_db', () => ({ getDb: async () => state.db, getUser: mocks.getUser, checkIsAdminAsync: mocks.isAdmin }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/auth', () => ({ auth: async () => (session.user ? { user: { email: session.user } } : null) }));
vi.mock('@/config/admins', async (orig) => ({
    ...(await orig()),
    isAdminAsync: mocks.isAdmin,
    isModeratorOrAdminAsync: mocks.isAdmin,
}));
vi.mock('@/lib/orgMembership', async (orig) => ({
    ...(await orig()), isOrgMate: mocks.isOrgMate, getOrgMemberEmailsFor: mocks.getOrgMemberEmailsFor,
    isOwnerOrOrgMate: (v: string | null | undefined, o: string | null | undefined) => mocks.isOwnerOrOrgMate(v?.trim().toLowerCase(), o?.trim().toLowerCase()),
}));
vi.mock('@/config/features', async (orig) => ({
    ...(await orig()),
    getFeatureFlag: vi.fn(async (flag: string) => flag === 'ENABLE_PII_ACCESS_GATING'),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/pendingSearchLog', () => ({ closePendingSearchesForAdopter: vi.fn(async () => undefined) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/background', () => ({ runAfterResponse: vi.fn(async (_n: string, task: () => Promise<unknown>) => { await task(); }) }));
vi.mock('./notifications', () => ({
    createNotification: vi.fn(async (d: Record<string, unknown>) => {
        notify.create.push(d);
        // Stored like the real one (the rename notice collapse reads it back).
        const id = `n-${notify.create.length}`;
        (state.sqlite as { prepare: (q: string) => { run: (...a: unknown[]) => unknown } } | null)?.prepare(
            'INSERT INTO notifications (id, user_id, type, title, body, url, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(id, d.userId, d.type ?? 'contract_result', d.title, d.body, d.url ?? null, JSON.stringify({ ...(d.metadata as object ?? {}), ...(d.template ? { template: d.template } : {}) }), Math.floor(Date.now() / 1000));
        return id;
    }),
    notifyAdmins: vi.fn(async (d: Record<string, unknown>) => { notify.admins.push(d); }),
    resolveDisplayName: vi.fn(async (email: string) => email.split('@')[0]),
    resolveDisplayNames: vi.fn(async (emails: string[]) => Object.fromEntries(emails.map(e => [e, e.split('@')[0]]))),
}));
vi.mock('@/lib/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') },
    generateErrorId: () => 'gen12345',
    withTrace: (_op: string, fn: () => unknown) => fn(),
}));

import { changeProfileAge, changeProfileName, getRenameUndoOption, undoProfileRename } from './profileIdentity';
import { saveAdoption } from './adoptions';
import { flagAdopter } from './flags';
import { findAdopters } from './findAdopters';
import { getAdopterApprovers } from './piiAccess';
import { loadApprovers } from '@/lib/piiAccessRequest';
import { tokenizeAdopter } from '@/lib/adopterTokenize';
import { insertRecord } from './_recordWrite';
import { setProfileAge, recordSignerRename } from '@/lib/profileIdentity';
import { isMinorProfile } from '@/lib/minors';
import { isProfileIsMinorError } from '@/domain/profileIdentity';
import { deserializeContactEntries } from '@/lib/contactEntries';
import { saveApiActivity } from '@/lib/api/records';
import { removeContactEntry } from './removeContactEntry';
import { checkHouseholdPersonEdit } from './households';
import { updateContactEntry } from './updateContactEntry';
import { addContactEntry } from './addContactEntry';
import { saveAdopter, appendToExistingAdopter, checkAdopterDeletable } from './adopters';
import { mergeAdopters, unmergeAdopters } from '@/lib/adopterMerge';
import { mergeContactEntries, CONTACT_ENTRIES_FULL, MAX_CONTACT_ENTRIES, RENAME_ALIAS_AUTHOR } from '@/lib/contactEntries';
import { knownAsNames, RENAME_NOTICE_WINDOW_MS, RENAME_RATE_LIMIT } from '@/domain/profileIdentity';
import { preserveRenameAliases } from '@/domain/profileIdentity';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { get: (...a: unknown[]) => Row | undefined; run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Row[] } };

const PEDRO_PHONE = '+54 11 4200 0001';

const as = async <T>(user: string | null, fn: () => Promise<T>): Promise<T> => {
    const before = session.user;
    session.user = user;
    try { return await fn(); } finally { session.user = before; }
};
const pedro = () => sqlite.prepare("SELECT * FROM adopters WHERE id = 'pedro'").get()!;
const entriesOf = (id: string) => deserializeContactEntries(sqlite.prepare('SELECT contact_entries AS c FROM adopters WHERE id = ?').get(id)!.c as string);
const historyOf = (adopterId: string) => sqlite.prepare('SELECT id, changed_by, kind, changes FROM adopter_history WHERE adopter_id = ? ORDER BY rowid').all(adopterId)
    .map(r => ({ ...r, id: r.id as string, changes: JSON.parse(r.changes as string) }));
const noticesOfType = (type: string) => notify.create.filter(n => n.type === type);
const findsByName = async (name: string) => (await as(MATE, () => findAdopters({ name }, { mode: 'duplicate' }))).results.map(r => r.adopterId);

beforeEach(async () => {
    const m = migratedDb();
    state.db = m.db;
    state.sqlite = m.sqlite;
    sqlite = m.sqlite as unknown as typeof sqlite;
    notify.create.length = 0;
    notify.admins.length = 0;
    session.user = STRANGER;
    const insert = sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at, contact_entries, contact_info) VALUES (?, ?, '5', ?, 1000, 1000, ?, ?)`);
    insert.run('pedro', 'Pedro Paez', OWNER, JSON.stringify([{ id: 'pc', type: 'phone', value: PEDRO_PHONE, addedBy: OWNER }]), `Teléfono: ${PEDRO_PHONE}`);
    insert.run('lucas', 'Lucas Paez', OWNER, null, null);
    await tokenizeAdopter('pedro');
    await tokenizeAdopter('lucas');
});

describe('changeProfileName — open to anyone signed in', () => {
    it('a stranger renames Pedro: the name changes, the old name is a hidden alias that search still finds, the owner is told with «Deshacer», the stranger gains nothing', async () => {
        const res = await changeProfileName({ adopterId: 'pedro', name: 'P. Paez', expectedName: 'Pedro Paez' });
        expect(res).toMatchObject({ ok: true, name: 'P. Paez', aliasKept: true });

        expect(pedro().name).toBe('P. Paez');
        const alias = entriesOf('pedro').find(e => e.type === 'alias');
        expect(alias).toMatchObject({ type: 'alias', value: 'Pedro Paez', addedBy: RENAME_ALIAS_AUTHOR, fromRename: true });
        // The phone is untouched; the blob now carries the old name too (discovery LIKE search reads it).
        expect(entriesOf('pedro').find(e => e.type === 'phone')).toMatchObject({ value: PEDRO_PHONE });
        expect(pedro().contact_info).toContain('Pedro Paez');

        // Search for the old name still finds the profile (token index, re-tokenized on rename).
        expect(await findsByName('Pedro Paez')).toContain('pedro');
        expect(await findsByName('P. Paez')).toContain('pedro');

        // History: a contribution, with the field key the conflict notice reads.
        const h = historyOf('pedro');
        expect(h).toHaveLength(1);
        expect(h[0]).toMatchObject({ changed_by: STRANGER, kind: 'contribution' });
        expect(h[0].changes).toEqual({
            name: { from: 'Pedro Paez', to: 'P. Paez' },
            name_changed: { from: 'Pedro Paez', to: 'P. Paez', aliasKept: true },
        });

        // The owner's team (owner + mate) hears, with the undo; the stranger doesn't.
        const notices = noticesOfType('profile_renamed');
        expect(notices.map(n => n.userId).sort()).toEqual([MATE, OWNER].sort());
        expect(notices[0]).toMatchObject({
            url: '/adopter/pedro',
            title: 'stranger cambió el nombre de Pedro Paez a P. Paez',
            metadata: expect.objectContaining({ undo: { historyId: h[0].id }, profileId: 'pedro' }),
        });
        expect(notify.create.some(n => n.userId === STRANGER)).toBe(false);

        // Not an approver: no standing from renaming.
        expect((await loadApprovers('pedro')).all).not.toContain(STRANGER);
        const { owner, editors } = await getAdopterApprovers('pedro');
        expect([owner, ...editors]).not.toContain(STRANGER);
    });

    it("the owner's own team renames or changes the age → no notice (D54); an admin from outside the team → the team is told", async () => {
        await as(MATE, () => changeProfileName({ adopterId: 'pedro', name: 'Pedro A. Paez', expectedName: 'Pedro Paez' }));
        await as(OWNER, () => changeProfileAge({ adopterId: 'pedro', age: 40, isMinor: false }));
        expect(notify.create).toHaveLength(0);
        await as(ADMIN, () => changeProfileName({ adopterId: 'pedro', name: 'P. Paez', expectedName: 'Pedro A. Paez' }));
        expect(noticesOfType('profile_renamed').map(n => n.userId).sort()).toEqual([MATE, OWNER].sort());
    });

    it('a stale expectedName → conflict with the stored name and who wrote it; nothing changes', async () => {
        await as(MATE, () => changeProfileName({ adopterId: 'pedro', name: 'Pedro A. Paez', expectedName: 'Pedro Paez' }));
        notify.create.length = 0;
        const res = await changeProfileName({ adopterId: 'pedro', name: 'P. Paez', expectedName: 'Pedro Paez' });
        expect(res).toEqual({ ok: false, error: 'conflict', theirs: 'Pedro A. Paez', by: expect.any(String) });
        expect((res as { by: string }).by).not.toBe('');
        expect(pedro().name).toBe('Pedro A. Paez');
        expect(notify.create).toHaveLength(0);
        // «Guardar la mía igual»: the editor saw theirs, so theirs is what's compared.
        expect(await changeProfileName({ adopterId: 'pedro', name: 'P. Paez', expectedName: 'Pedro A. Paez' })).toMatchObject({ ok: true });
        expect(entriesOf('pedro').filter(e => e.type === 'alias').map(e => e.value)).toEqual(['Pedro Paez', 'Pedro A. Paez']);
    });

    it('a teammate changed another inline field since this tab loaded it → reported back («Actualizado por …»), never overwritten', async () => {
        sqlite.prepare("UPDATE adopters SET family_members = 'Hijo y perro' WHERE id = 'pedro'").run();
        sqlite.prepare("INSERT INTO adopter_history (id, adopter_id, changed_by, changes, changed_at, kind) VALUES ('hf', 'pedro', ?, ?, 1000, 'edit')")
            .run(MATE, JSON.stringify({ familyMembers: { from: 'Hijo', to: 'Hijo y perro' } }));
        const res = await as(OWNER, () => changeProfileName({ adopterId: 'pedro', name: 'P. Paez', expectedName: 'Pedro Paez', loaded: { familyMembers: 'Hijo' } }));
        expect(res).toMatchObject({ ok: true, updatedByOthers: [{ field: 'familyMembers', value: 'Hijo y perro', by: expect.any(String) }] });
        expect(pedro().family_members).toBe('Hijo y perro');
        const same = await as(OWNER, () => changeProfileName({ adopterId: 'pedro', name: 'Pedro', expectedName: 'P. Paez', loaded: { familyMembers: 'Hijo y perro' } }));
        expect(same).not.toHaveProperty('updatedByOthers');
    });

    it('typing the stored name is a saved no-op; signed out, empty or unknown is refused', async () => {
        expect(await changeProfileName({ adopterId: 'pedro', name: ' Pedro Paez ', expectedName: 'something old' })).toMatchObject({ ok: true });
        expect(historyOf('pedro')).toHaveLength(0);
        expect(await as(null, () => changeProfileName({ adopterId: 'pedro', name: 'X', expectedName: 'Pedro Paez' }))).toEqual({ ok: false, error: 'not_authenticated' });
        expect(await changeProfileName({ adopterId: 'pedro', name: '   ', expectedName: 'Pedro Paez' })).toEqual({ ok: false, error: 'invalid' });
        expect(await changeProfileName({ adopterId: 'nobody', name: 'X', expectedName: 'Y' })).toEqual({ ok: false, error: 'not_found' });
    });
});

describe('undoProfileRename — the owner team or an admin', () => {
    async function strangerRenames() {
        await changeProfileName({ adopterId: 'pedro', name: 'P. Paez', expectedName: 'Pedro Paez' });
        notify.create.length = 0;
        return historyOf('pedro')[0].id as string;
    }

    it('the owner undoes: the name is back, the reverted name is kept as an alias, the restored one is no longer «Conocido/a como», the renamer is told', async () => {
        const historyId = await strangerRenames();
        expect(await as(OWNER, () => getRenameUndoOption(historyId))).toEqual({ status: 'can_undo', adopterId: 'pedro', from: 'Pedro Paez', to: 'P. Paez' });
        expect(await as(OWNER, () => undoProfileRename(historyId))).toMatchObject({ ok: true, name: 'Pedro Paez' });

        expect(pedro().name).toBe('Pedro Paez');
        const aliases = entriesOf('pedro').filter(e => e.type === 'alias');
        expect(aliases).toEqual([expect.objectContaining({ value: 'P. Paez', addedBy: RENAME_ALIAS_AUTHOR, fromRename: true })]);
        expect(await findsByName('P. Paez')).toContain('pedro');

        const undo = historyOf('pedro')[1];
        expect(undo).toMatchObject({ changed_by: OWNER, kind: 'edit' });
        expect(undo.changes.name_changed).toMatchObject({ from: 'P. Paez', to: 'Pedro Paez', undoOf: historyId });

        const told = noticesOfType('profile_rename_undone');
        expect(told.map(n => n.userId)).toEqual([STRANGER]);
        expect(noticesOfType('profile_renamed')).toHaveLength(0);

        // Once only.
        expect(await as(OWNER, () => undoProfileRename(historyId))).toEqual({ ok: false, error: 'already_undone' });
        expect(await as(OWNER, () => getRenameUndoOption(historyId))).toEqual({ status: 'already_undone' });
    });

    it('a stranger (even the renamer) cannot undo; an admin can', async () => {
        const historyId = await strangerRenames();
        expect(await undoProfileRename(historyId)).toEqual({ ok: false, error: 'not_authorized' });
        expect(await getRenameUndoOption(historyId)).toEqual({ status: 'not_authorized' });
        expect(pedro().name).toBe('P. Paez');
        expect(await as(ADMIN, () => undoProfileRename(historyId))).toMatchObject({ ok: true });
    });

    it('a later rename supersedes the undo — it never clobbers a newer name; an undo row is not undoable', async () => {
        const historyId = await strangerRenames();
        await as(MATE, () => changeProfileName({ adopterId: 'pedro', name: 'Pedro Paez Gómez', expectedName: 'P. Paez' }));
        expect(await as(OWNER, () => undoProfileRename(historyId))).toEqual({ ok: false, error: 'superseded' });
        expect(pedro().name).toBe('Pedro Paez Gómez');
        expect(await as(OWNER, () => undoProfileRename('missing-row'))).toEqual({ ok: false, error: 'not_authorized' });
    });
});

describe('changeProfileAge and minors', () => {
    it('age 12 → a minor (box forced on, age_as_of today in UTC); age 30 with the box ticked → not a minor; no age + box → minor', async () => {
        expect(await changeProfileAge({ adopterId: 'lucas', age: 12, isMinor: false })).toMatchObject({ ok: true, age: 12, isMinor: true });
        const row = sqlite.prepare("SELECT age, age_as_of, is_minor FROM adopters WHERE id = 'lucas'").get()!;
        expect(row).toMatchObject({ age: 12, is_minor: 1, age_as_of: new Date().toISOString().slice(0, 10) });
        expect(await isMinorProfile(state.db as never, 'lucas')).toBe(true);
        const h = historyOf('lucas').at(-1)!;
        expect(h).toMatchObject({ changed_by: STRANGER, kind: 'contribution' });
        expect(h.changes).toEqual({ age_changed: { from: { age: null, minor: false }, to: { age: 12, minor: true } } });
        const told = noticesOfType('profile_age_changed');
        expect(told.map(n => n.userId).sort()).toEqual([MATE, OWNER].sort());

        expect(await changeProfileAge({ adopterId: 'lucas', age: 30, isMinor: true })).toMatchObject({ ok: true, isMinor: false });
        expect(sqlite.prepare("SELECT is_minor FROM adopters WHERE id = 'lucas'").get()!.is_minor).toBe(0);
        expect(await changeProfileAge({ adopterId: 'lucas', age: null, isMinor: true })).toMatchObject({ ok: true, age: null, isMinor: true });
        expect(await isMinorProfile(state.db as never, 'lucas')).toBe(true);
        expect(await changeProfileAge({ adopterId: 'lucas', age: 12.5, isMinor: false })).toEqual({ ok: false, error: 'invalid' });
        expect(await changeProfileAge({ adopterId: 'lucas', age: 121, isMinor: false })).toEqual({ ok: false, error: 'invalid' });
    });

    it('on a minor: saveAdoption refused (a request, an adoption with a rating), flagAdopter refused — with a clear code; nothing written', async () => {
        await changeProfileAge({ adopterId: 'lucas', age: 12, isMinor: true });
        const before = sqlite.prepare("SELECT COUNT(*) AS n FROM adoptions WHERE adopter_id = 'lucas'").get()!.n;
        await expect(saveAdoption({ adopterId: 'lucas', recordType: 'adoption_request', species: 'cat', status: 'pending' } as never))
            .rejects.toSatisfy((e: unknown) => isProfileIsMinorError(e) && /Error ID: \w+/.test((e as Error).message));
        await expect(saveAdoption({ adopterId: 'lucas', recordType: 'adoption', animalName: 'Nina', species: 'cat', status: 'completed', rating: 1 } as never))
            .rejects.toSatisfy(isProfileIsMinorError);
        await expect(flagAdopter('lucas', 'inaccurate_information', 'datos falsos')).rejects.toSatisfy(isProfileIsMinorError);
        expect(sqlite.prepare("SELECT COUNT(*) AS n FROM adoptions WHERE adopter_id = 'lucas'").get()!.n).toBe(before);
        expect(sqlite.prepare("SELECT COUNT(*) AS n FROM adopter_flags WHERE adopter_id = 'lucas'").get()!.n).toBe(0);
        // Every create path (API, forms, imports) goes through the record writer.
        await expect(insertRecord(state.db as never, { adopterId: 'lucas', recordType: 'observation', details: 'x' }, OWNER)).rejects.toSatisfy(isProfileIsMinorError);
    });

    it('the API refuses a record on a minor it matched (422 profile_is_minor) before writing anything', async () => {
        await changeProfileAge({ adopterId: 'lucas', age: 12, isMinor: true });
        const ctx = { db: state.db, key: { id: 'k1', name: 'Catpuccino', ownerEmail: OWNER, importMode: null }, requestId: 'req-1', log: {}, rowClaimed: false } as never;
        const req = { person: { fullName: 'Lucas Paez' }, activity: { activityType: 'adoption_request', species: 'cat', externalId: 'ext-1' } } as never;
        await expect(saveApiActivity(ctx, req, { result: 'found', profileId: 'lucas' } as never, new Map(), new Map()))
            .rejects.toMatchObject({ status: 422, code: 'profile_is_minor' });
        expect(sqlite.prepare("SELECT COUNT(*) AS n FROM adoptions WHERE adopter_id = 'lucas'").get()!.n).toBe(0);
    });

    it('a rating cannot land on a minor by moving an existing record onto them', async () => {
        const recordId = await as(OWNER, () => saveAdoption({ adopterId: 'pedro', recordType: 'observation', species: 'cat', status: 'completed', rating: 1, details: 'x' } as never));
        await changeProfileAge({ adopterId: 'lucas', age: 12, isMinor: true });
        await expect(as(OWNER, () => saveAdoption({ id: recordId.id, adopterId: 'lucas', rating: 2 } as never))).rejects.toSatisfy(isProfileIsMinorError);
        expect(sqlite.prepare('SELECT adopter_id FROM adoptions WHERE id = ?').get(recordId.id)!.adopter_id).toBe('pedro');
    });

    it('at 18 (age + time) → no longer a minor, records allowed again', async () => {
        const twoYearsAgo = new Date(Date.UTC(new Date().getUTCFullYear() - 2, 0, 1));
        await setProfileAge(state.db as never, { adopterId: 'lucas', age: 16, isMinor: true, actor: OWNER, today: twoYearsAgo });
        expect(sqlite.prepare("SELECT is_minor FROM adopters WHERE id = 'lucas'").get()!.is_minor).toBe(1);
        expect(await isMinorProfile(state.db as never, 'lucas')).toBe(false);
        expect(await saveAdoption({ adopterId: 'lucas', recordType: 'adoption_request', species: 'cat', status: 'pending' } as never)).toMatchObject({ success: true });
    });

    it('a profile with records or open alerts cannot be marked a minor (an adult with a history is never buried)', async () => {
        await as(OWNER, () => saveAdoption({ adopterId: 'pedro', recordType: 'observation', species: 'cat', status: 'completed', rating: 1, details: 'x' } as never));
        expect(await changeProfileAge({ adopterId: 'pedro', age: 12, isMinor: true })).toEqual({ ok: false, error: 'has_activity' });
        expect(await changeProfileAge({ adopterId: 'pedro', age: null, isMinor: true })).toEqual({ ok: false, error: 'has_activity' });
        expect(pedro()).toMatchObject({ age: null, is_minor: 0 });
        // An adult age is fine.
        expect(await changeProfileAge({ adopterId: 'pedro', age: 45, isMinor: false })).toMatchObject({ ok: true, isMinor: false });

        await flagAdopter('lucas', 'inaccurate_information', 'datos falsos');
        expect(await changeProfileAge({ adopterId: 'lucas', age: 12, isMinor: true })).toEqual({ ok: false, error: 'has_activity' });
    });
});

describe('Task 3 fix round 1', () => {
    const renameAliasOf = (id: string) => entriesOf(id).find(e => e.fromRename);
    const tokensOf = (id: string) => sqlite.prepare('SELECT token_value AS v FROM duplicate_tokens WHERE adopter_id = ?').all(id).map(r => r.v);
    const discovers = async (q: string) => (await as(MATE, () => findAdopters({ raw: q }, { mode: 'discovery' }))).results.map(r => r.adopterId);

    it('C1: the renamer cannot remove or rewrite the rename alias; the old name stays in the token index and discovery search', async () => {
        await changeProfileName({ adopterId: 'pedro', name: 'P. Paez', expectedName: 'Pedro Paez' });
        const alias = renameAliasOf('pedro')!;
        expect(alias).toBeTruthy();
        expect(await removeContactEntry({ adopterId: 'pedro', entryId: alias.id! })).toMatchObject({ ok: false });
        expect(await updateContactEntry({ adopterId: 'pedro', entryId: alias.id!, value: 'Nadie' })).toMatchObject({ ok: false });
        expect(renameAliasOf('pedro')).toMatchObject({ value: 'Pedro Paez', fromRename: true });
        expect(tokensOf('pedro')).toContain('pedro paez');
        expect(await discovers('Pedro Paez')).toContain('pedro');
    });

    it('C1: a plain alias equal to the current name, added by the stranger before renaming, becomes the rename alias and is not theirs to delete', async () => {
        expect(await addContactEntry({ adopterId: 'pedro', type: 'alias', value: 'Pedro Paez' })).toMatchObject({ ok: true });
        await changeProfileName({ adopterId: 'pedro', name: 'P. Paez', expectedName: 'Pedro Paez' });
        const alias = entriesOf('pedro').find(e => e.type === 'alias' && e.value === 'Pedro Paez')!;
        expect(alias).toMatchObject({ fromRename: true });
        expect(await removeContactEntry({ adopterId: 'pedro', entryId: alias.id! })).toMatchObject({ ok: false });
        expect(tokensOf('pedro')).toContain('pedro paez');
        expect(await discovers('Pedro Paez')).toContain('pedro');
    });

    it('C1: the owner team can rewrite (flag kept) or remove a junk rename alias', async () => {
        await changeProfileName({ adopterId: 'pedro', name: 'P. Paez', expectedName: 'Pedro Paez' });
        const alias = renameAliasOf('pedro')!;
        expect(await as(OWNER, () => updateContactEntry({ adopterId: 'pedro', entryId: alias.id!, value: 'Pedro Páez' }))).toMatchObject({ ok: true });
        expect(renameAliasOf('pedro')).toMatchObject({ value: 'Pedro Páez', fromRename: true });
        expect(await as(MATE, () => removeContactEntry({ adopterId: 'pedro', entryId: alias.id! }))).toMatchObject({ ok: true });
        expect(renameAliasOf('pedro')).toBeUndefined();
    });

    it("C2: a non-privileged renamer never gets another field's value back (gating on)", async () => {
        sqlite.prepare("UPDATE adopters SET family_members = 'Hijo y perro' WHERE id = 'pedro'").run();
        const res = await changeProfileName({ adopterId: 'pedro', name: 'P. Paez', expectedName: 'Pedro Paez', loaded: { familyMembers: null } });
        expect(res).toMatchObject({ ok: true });
        expect(res).not.toHaveProperty('updatedByOthers');
        expect(JSON.stringify(res)).not.toContain('Hijo y perro');
    });

    it('I1: merge → rename → unmerge keeps the rename alias (the old name stays findable)', async () => {
        sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES ('pedro2', 'Pedro P.', '5', ?, 1000, 1000)`).run(OWNER);
        const merged = await mergeAdopters('pedro', 'pedro2', OWNER);
        expect(merged.success).toBe(true);
        await changeProfileName({ adopterId: 'pedro', name: 'P. Paez', expectedName: 'Pedro Paez' });
        expect((await unmergeAdopters(merged.auditId!, ADMIN)).success).toBe(true);
        expect(pedro().name).toBe('P. Paez');
        expect(renameAliasOf('pedro')).toMatchObject({ value: 'Pedro Paez', fromRename: true });
        expect(entriesOf('pedro').find(e => e.type === 'phone')).toMatchObject({ value: PEDRO_PHONE });
        expect(tokensOf('pedro')).toContain('pedro paez');
    });

    it('I2: a name change through saveAdopter keeps the alias and the rename history too (admin from outside the team → the team is told)', async () => {
        const res = await as(ADMIN, () => saveAdopter({ id: 'pedro', name: 'P. Paez' } as never, { loaded: { name: 'Pedro Paez' } }));
        expect(res).toMatchObject({ success: true });
        expect(pedro().name).toBe('P. Paez');
        expect(renameAliasOf('pedro')).toMatchObject({ value: 'Pedro Paez', fromRename: true });
        expect(historyOf('pedro').at(-1)!.changes.name_changed).toMatchObject({ from: 'Pedro Paez', to: 'P. Paez' });
        expect(noticesOfType('profile_renamed').map(n => n.userId).sort()).toEqual([MATE, OWNER].sort());
        // A stale loaded name is a conflict, never an overwrite.
        const stale = await as(OWNER, () => saveAdopter({ id: 'pedro', name: 'Otro' } as never, { loaded: { name: 'Pedro Paez' } }));
        expect(stale).toMatchObject({ success: true, conflicts: [expect.objectContaining({ field: 'name', value: 'P. Paez' })] });
        expect(pedro().name).toBe('P. Paez');
    });

    it('only the rename code sets fromRename: client JSON on create and append is stripped', async () => {
        const forged = JSON.stringify([{ id: 'f', type: 'alias', value: 'Hidden Name', fromRename: true }, { id: 'p', type: 'phone', value: '+54 11 5555 0000' }]);
        const created = await saveAdopter({ id: '', name: 'Nuevo', contactEntries: forged } as never);
        const newId = (created as { id: string }).id;
        expect(entriesOf(newId).find(e => e.type === 'alias')).not.toHaveProperty('fromRename');
        await as(OWNER, () => appendToExistingAdopter('lucas', { contactEntries: forged }));
        expect(entriesOf('lucas').find(e => e.type === 'alias')).not.toHaveProperty('fromRename');
    });

    it('renameUndoState: a stranger gets the same answer for a real rename and an unknown id', async () => {
        await changeProfileName({ adopterId: 'pedro', name: 'P. Paez', expectedName: 'Pedro Paez' });
        const real = historyOf('pedro')[0].id;
        expect(await getRenameUndoOption('no-such-row')).toEqual(await getRenameUndoOption(real));
        expect(await undoProfileRename('no-such-row')).toEqual(await undoProfileRename(real));
    });

    it('a rename of a profile with no real owner tells the admins (with «Deshacer»)', async () => {
        sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES ('orphan', 'Ana Gómez', '5', 'anonymous', 1000, 1000)`).run();
        expect(await changeProfileName({ adopterId: 'orphan', name: 'A. Gómez', expectedName: 'Ana Gómez' })).toMatchObject({ ok: true });
        expect(notify.admins).toEqual([expect.objectContaining({ type: 'profile_renamed', actorEmail: STRANGER, metadata: expect.objectContaining({ undo: { historyId: expect.any(String) } }) })]);
    });
});

describe('Task 3 fix round 2 — no path makes an old name unfindable', () => {
    const aliasNamed = (id: string, v: string) => entriesOf(id).find(e => e.type === 'alias' && e.value === v);
    const tokensOf = (id: string) => sqlite.prepare('SELECT token_value AS v FROM duplicate_tokens WHERE adopter_id = ?').all(id).map(r => r.v);

    it('merge dedupe: the absorbed profile’s rename alias beats a plain copy on the survivor (marker kept; the plain copy’s contributor cannot erase it)', async () => {
        expect(mergeContactEntries(
            [{ id: 'p', type: 'alias', value: 'Pedro Paez', addedBy: STRANGER }],
            [{ id: 'r', type: 'alias', value: 'pedro paez', fromRename: true }],
        )).toEqual([expect.objectContaining({ fromRename: true })]);

        sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at, contact_entries) VALUES ('abs', 'P. Paez', '5', ?, 1000, 1000, ?)`)
            .run(OWNER, JSON.stringify([{ id: 'r1', type: 'alias', value: 'Viejo Nombre', fromRename: true, addedBy: MATE }]));
        expect(await addContactEntry({ adopterId: 'pedro', type: 'alias', value: 'Viejo Nombre' })).toMatchObject({ ok: true });
        expect((await mergeAdopters('pedro', 'abs', OWNER)).success).toBe(true);
        const alias = aliasNamed('pedro', 'Viejo Nombre')!;
        expect(alias).toMatchObject({ fromRename: true });
        expect(await removeContactEntry({ adopterId: 'pedro', entryId: alias.id! })).toMatchObject({ ok: false });
    });

    it('merge: the absorbed profile’s name carried over is a rename-protected alias', async () => {
        sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES ('abs', 'Pedro P.', '5', ?, 1000, 1000)`).run(OWNER);
        expect((await mergeAdopters('pedro', 'abs', STRANGER)).success).toBe(true);
        const alias = aliasNamed('pedro', 'Pedro P.')!;
        expect(alias).toMatchObject({ fromRename: true });
        expect(await removeContactEntry({ adopterId: 'pedro', entryId: alias.id! })).toMatchObject({ ok: false });
    });

    it('unmerge: rename aliases that came from the absorbed profile (and its carried name) leave with it; the survivor’s own later rename stays', async () => {
        sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at, contact_entries) VALUES ('abs', 'Pedro P.', '5', ?, 1000, 1000, ?)`)
            .run(OWNER, JSON.stringify([{ id: 'r1', type: 'alias', value: 'Nombre Absorbido', fromRename: true, addedBy: MATE }]));
        const merged = await mergeAdopters('pedro', 'abs', OWNER);
        await changeProfileName({ adopterId: 'pedro', name: 'P. Paez', expectedName: 'Pedro Paez' });
        expect((await unmergeAdopters(merged.auditId!, ADMIN)).success).toBe(true);
        expect(aliasNamed('pedro', 'Nombre Absorbido')).toBeUndefined();
        expect(aliasNamed('pedro', 'Pedro P.')).toBeUndefined();
        expect(aliasNamed('pedro', 'Pedro Paez')).toMatchObject({ fromRename: true });
        expect(tokensOf('pedro')).toContain('pedro paez');
    });

    it('unmerge: a plain alias in the snapshot that a later rename upgraded comes back as the rename alias', async () => {
        expect(await addContactEntry({ adopterId: 'pedro', type: 'alias', value: 'Pedro Paez' })).toMatchObject({ ok: true });
        sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES ('abs', 'Pedro P.', '5', ?, 1000, 1000)`).run(OWNER);
        const merged = await mergeAdopters('pedro', 'abs', OWNER);
        await changeProfileName({ adopterId: 'pedro', name: 'P. Paez', expectedName: 'Pedro Paez' });
        expect((await unmergeAdopters(merged.auditId!, ADMIN)).success).toBe(true);
        const alias = aliasNamed('pedro', 'Pedro Paez')!;
        expect(alias).toMatchObject({ fromRename: true });
        expect(entriesOf('pedro').filter(e => e.type === 'alias' && e.value === 'Pedro Paez')).toHaveLength(1);
        expect(await removeContactEntry({ adopterId: 'pedro', entryId: alias.id! })).toMatchObject({ ok: false });
    });

    it('preserveRenameAliases: a wholesale replacement keeps every rename alias (upgrading a plain copy)', () => {
        const prev = [{ id: 'a', type: 'alias' as const, value: 'Old', fromRename: true as const }, { id: 'p', type: 'phone' as const, value: '1' }];
        expect(preserveRenameAliases(prev, [{ id: 'e', type: 'email', value: 'x@y.com' }]))
            .toEqual([{ ...prev[0], addedBy: RENAME_ALIAS_AUTHOR }, { id: 'e', type: 'email', value: 'x@y.com' }]);
        expect(preserveRenameAliases(prev, [{ id: 'b', type: 'alias', value: 'old' }])).toEqual([{ id: 'b', type: 'alias', value: 'old', addedBy: RENAME_ALIAS_AUTHOR, fromRename: true }]);
    });
});

describe('Task 3 fix round 3', () => {
    it("unmerge: the absorbed side's plain alias equal to the survivor's name, upgraded by a later rename on the survivor, stays (the previous name never vanishes)", async () => {
        sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at, contact_entries) VALUES ('abs', 'Pedro P.', '5', ?, 1000, 1000, ?)`)
            .run(OWNER, JSON.stringify([{ id: 'abs-alias', type: 'alias', value: 'Pedro Paez', addedBy: MATE }]));
        const merged = await mergeAdopters('pedro', 'abs', OWNER);
        expect(merged.success).toBe(true);
        await changeProfileName({ adopterId: 'pedro', name: 'P. Paez', expectedName: 'Pedro Paez' });
        expect(entriesOf('pedro').find(e => e.id === 'abs-alias')).toMatchObject({ fromRename: true });
        expect((await unmergeAdopters(merged.auditId!, ADMIN)).success).toBe(true);
        expect(entriesOf('pedro').find(e => e.type === 'alias' && e.value === 'Pedro Paez')).toMatchObject({ fromRename: true });
        expect(sqlite.prepare("SELECT token_value AS v FROM duplicate_tokens WHERE adopter_id = 'pedro'").all().map(r => r.v)).toContain('pedro paez');
    });
});


describe('Final fix S1/S2 — the rename alias survives the contact cap and old builds', () => {
    const tokensOf = (id: string) => sqlite.prepare('SELECT token_value AS v FROM duplicate_tokens WHERE adopter_id = ?').all(id).map(r => r.v);
    const rawEntries = (id: string) => JSON.parse(sqlite.prepare('SELECT contact_entries AS c FROM adopters WHERE id = ?').get(id)!.c as string) as Array<Record<string, unknown>>;

    it('S1 attack: 50 junk aliases + rename → the add past the cap is refused, the old name stays first, findable and shown; removing the junk keeps it in storage', async () => {
        // Pedro has a phone: 49 junk aliases fill the cap.
        for (let i = 0; i < MAX_CONTACT_ENTRIES - 1; i++) {
            expect(await addContactEntry({ adopterId: 'pedro', type: 'alias', value: `Junk ${i}` })).toMatchObject({ ok: true, appended: true });
        }
        expect(await addContactEntry({ adopterId: 'pedro', type: 'alias', value: 'One too many' })).toEqual({ ok: false, error: CONTACT_ENTRIES_FULL });
        expect(await changeProfileName({ adopterId: 'pedro', name: 'P. Paez', expectedName: 'Pedro Paez' })).toMatchObject({ ok: true, aliasKept: true });

        const read = entriesOf('pedro');
        expect(read[0]).toMatchObject({ type: 'alias', value: 'Pedro Paez', fromRename: true, addedBy: RENAME_ALIAS_AUTHOR });
        expect(rawEntries('pedro')[0]).toMatchObject({ value: 'Pedro Paez', fromRename: true });
        expect(tokensOf('pedro')).toContain('pedro paez');
        expect(knownAsNames(read, 'P. Paez')).toEqual(['Pedro Paez']);

        // The stranger removes their own junk: the write never drops the old name.
        for (const e of read.filter(x => x.type === 'alias' && x.value.startsWith('Junk')).slice(0, 5)) {
            expect(await removeContactEntry({ adopterId: 'pedro', entryId: e.id! })).toMatchObject({ ok: true });
        }
        expect(rawEntries('pedro').some(e => e.value === 'Pedro Paez' && e.fromRename === true)).toBe(true);
        expect(tokensOf('pedro')).toContain('pedro paez');
    });

    it('S1: a profile already over the cap keeps its rename alias wherever storage put it', async () => {
        const junk = Array.from({ length: 70 }, (_, i) => ({ id: `j${i}`, type: 'alias', value: `Junk ${i}`, addedBy: STRANGER }));
        sqlite.prepare("UPDATE adopters SET contact_entries = ? WHERE id = 'pedro'")
            .run(JSON.stringify([...junk, { id: 'r', type: 'alias', value: 'Pedro Viejo', addedBy: RENAME_ALIAS_AUTHOR, fromRename: true }]));
        await tokenizeAdopter('pedro');
        expect(entriesOf('pedro')[0]).toMatchObject({ id: 'r', fromRename: true });
        expect(tokensOf('pedro')).toContain('pedro viejo');
        // No add grows it further.
        expect(await addContactEntry({ adopterId: 'pedro', type: 'phone', value: '+54 11 4200 9999' })).toEqual({ ok: false, error: CONTACT_ENTRIES_FULL });
    });

    it('S1: appendToExistingAdopter and saveAdopter refuse to grow a list past the cap', async () => {
        const many = (n: number, p = 'x') => JSON.stringify(Array.from({ length: n }, (_, i) => ({ id: `${p}${i}`, type: 'alias', value: `${p} ${i}` })));
        expect(await as(OWNER, () => saveAdopter({ id: '', name: 'Nuevo', contactEntries: many(MAX_CONTACT_ENTRIES + 1) } as never)))
            .toEqual({ success: false, error: CONTACT_ENTRIES_FULL, errorId: expect.any(String) });
        sqlite.prepare("UPDATE adopters SET contact_entries = ? WHERE id = 'lucas'").run(many(MAX_CONTACT_ENTRIES - 1, 'l'));
        const r = await as(OWNER, () => appendToExistingAdopter('lucas', { contactEntries: many(2, 'n') }));
        expect(r).toMatchObject({ success: false, error: CONTACT_ENTRIES_FULL });
        expect(entriesOf('lucas')).toHaveLength(MAX_CONTACT_ENTRIES - 1);
    });

    it('S2: the alias is credited to the rename sentinel, the renamer only in the history row', async () => {
        await changeProfileName({ adopterId: 'pedro', name: 'P. Paez', expectedName: 'Pedro Paez' });
        expect(entriesOf('pedro').find(e => e.type === 'alias')).toMatchObject({ addedBy: RENAME_ALIAS_AUTHOR });
        expect(historyOf('pedro')[0]).toMatchObject({ changed_by: STRANGER });
    });

    it('S2: after an old build rewrote the list without `fromRename`, the renamer still cannot delete the old name and it stays hidden from the contacts', async () => {
        await changeProfileName({ adopterId: 'pedro', name: 'P. Paez', expectedName: 'Pedro Paez' });
        // What an old build writes back: the flag dropped, the sentinel author kept.
        const stripped = rawEntries('pedro').map(({ fromRename: _f, ...e }) => e);
        sqlite.prepare("UPDATE adopters SET contact_entries = ? WHERE id = 'pedro'").run(JSON.stringify(stripped));
        const alias = entriesOf('pedro').find(e => e.type === 'alias')!;
        expect(alias).toMatchObject({ fromRename: true });
        expect(await removeContactEntry({ adopterId: 'pedro', entryId: alias.id! })).toMatchObject({ ok: false });
        expect(await updateContactEntry({ adopterId: 'pedro', entryId: alias.id!, value: 'Nadie' })).toMatchObject({ ok: false });
        expect(knownAsNames(entriesOf('pedro'), 'P. Paez')).toEqual(['Pedro Paez']);
    });

    it("S2: the sentinel author never blocks the owner's own delete; a stranger's rename still counts as someone else's edit", async () => {
        await as(OWNER, () => changeProfileName({ adopterId: 'lucas', name: 'L. Paez', expectedName: 'Lucas Paez' }));
        expect(await as(OWNER, () => checkAdopterDeletable('lucas'))).toMatchObject({ canDelete: true });
        await changeProfileName({ adopterId: 'pedro', name: 'P. Paez', expectedName: 'Pedro Paez' });
        expect(await as(OWNER, () => checkAdopterDeletable('pedro'))).toMatchObject({ canDelete: false, collaborators: expect.objectContaining({ edits: 1 }) });
    });

    it('S2: client JSON carrying the sentinel author is not a rename alias (create and append)', async () => {
        const forged = JSON.stringify([{ id: 'f', type: 'alias', value: 'Hidden Name', addedBy: RENAME_ALIAS_AUTHOR }]);
        const created = await saveAdopter({ id: '', name: 'Nuevo', contactEntries: forged } as never);
        const e = entriesOf((created as { id: string }).id).find(x => x.type === 'alias')!;
        expect(e).not.toHaveProperty('fromRename');
        expect(e.addedBy).not.toBe(RENAME_ALIAS_AUTHOR);
        await as(OWNER, () => appendToExistingAdopter('lucas', { contactEntries: forged }));
        expect(entriesOf('lucas').find(x => x.type === 'alias')?.addedBy).not.toBe(RENAME_ALIAS_AUTHOR);
    });
});

describe('Final fix S5 — no rename email flood', () => {
    const bell = (userId: string) => sqlite.prepare("SELECT id, title, metadata, read FROM notifications WHERE user_id = ? AND type = 'profile_renamed'").all(userId)
        .map(r => ({ ...r, metadata: JSON.parse(r.metadata as string) }));

    it('two renames of one profile by one person within the window → one notice per teammate (one email), «Deshacer» on the latest', async () => {
        await changeProfileName({ adopterId: 'pedro', name: 'P. Paez', expectedName: 'Pedro Paez' });
        sqlite.prepare("UPDATE notifications SET read = 1").run();
        await changeProfileName({ adopterId: 'pedro', name: 'Pepe Paez', expectedName: 'P. Paez' });
        // createNotification (which sends the email twin) ran once per teammate.
        expect(noticesOfType('profile_renamed').map(n => n.userId).sort()).toEqual([MATE, OWNER].sort());
        const latest = historyOf('pedro').at(-1)!.id;
        for (const who of [OWNER, MATE]) {
            const rows = bell(who);
            expect(rows).toHaveLength(1);
            expect(rows[0]).toMatchObject({ read: 0, title: 'stranger cambió el nombre de Pedro Paez a Pepe Paez' });
            expect(rows[0].metadata).toMatchObject({ undo: { historyId: latest }, profileId: 'pedro' });
            expect(rows[0].metadata.template.params).toMatchObject({ fromName: 'Pedro Paez', toName: 'Pepe Paez' });
        }
    });

    it('another person, another profile, or past the window → its own notice', async () => {
        await changeProfileName({ adopterId: 'pedro', name: 'P. Paez', expectedName: 'Pedro Paez' });
        await changeProfileName({ adopterId: 'lucas', name: 'L. Paez', expectedName: 'Lucas Paez' });
        await as(ADMIN, () => changeProfileName({ adopterId: 'pedro', name: 'Pepe Paez', expectedName: 'P. Paez' }));
        expect(bell(OWNER)).toHaveLength(3);
        sqlite.prepare('UPDATE notifications SET created_at = created_at - ?').run(RENAME_NOTICE_WINDOW_MS / 1000 + 60);
        await changeProfileName({ adopterId: 'pedro', name: 'Pedro Paez', expectedName: 'Pepe Paez' });
        expect(bell(OWNER)).toHaveLength(4);
    });

    it(`a person renames at most ${RENAME_RATE_LIMIT} times an hour: then rate_limited, nothing changes`, async () => {
        for (let i = 0; i < RENAME_RATE_LIMIT; i++) {
            const from = i === 0 ? 'Lucas Paez' : `Lucas ${i - 1}`;
            expect(await changeProfileName({ adopterId: 'lucas', name: `Lucas ${i}`, expectedName: from })).toMatchObject({ ok: true });
        }
        const last = `Lucas ${RENAME_RATE_LIMIT - 1}`;
        expect(await changeProfileName({ adopterId: 'pedro', name: 'P. Paez', expectedName: 'Pedro Paez' })).toEqual({ ok: false, error: 'rate_limited' });
        expect(pedro().name).toBe('Pedro Paez');
        // Someone else is not limited; an hour later the person can rename again.
        expect(await as(MATE, () => changeProfileName({ adopterId: 'lucas', name: 'Lucas Paez', expectedName: last }))).toMatchObject({ ok: true });
        sqlite.prepare('UPDATE adopter_history SET changed_at = changed_at - 3700').run();
        expect(await changeProfileName({ adopterId: 'pedro', name: 'P. Paez', expectedName: 'Pedro Paez' })).toMatchObject({ ok: true });
    });
});

describe('Final fix S7 — a rename by signing a contract tells the owner team like any rename', () => {
    it('the history row (with «Deshacer») and the profile_renamed notice to the owner team', async () => {
        sqlite.prepare("UPDATE adopters SET name = 'Pedro Páez' WHERE id = 'pedro'").run();
        await recordSignerRename(state.db as never, { adopterId: 'pedro', ownerEmail: OWNER, from: 'Pedro Paez', to: 'Pedro Páez', aliasKept: true });
        const h = historyOf('pedro').at(-1)!;
        expect(h).toMatchObject({ changed_by: 'contract-signed-via-invitation', kind: 'contribution' });
        expect(h.changes.name_changed).toMatchObject({ from: 'Pedro Paez', to: 'Pedro Páez' });
        const notices = noticesOfType('profile_renamed');
        expect(notices.map(n => n.userId).sort()).toEqual([MATE, OWNER].sort());
        expect(notices[0]).toMatchObject({
            title: 'Al firmar el contrato, Pedro Paez cambió su nombre a Pedro Páez',
            metadata: expect.objectContaining({ undo: { historyId: h.id }, profileId: 'pedro' }),
        });
        expect(await as(OWNER, () => getRenameUndoOption(h.id))).toMatchObject({ status: 'can_undo' });
    });
});

describe('Final fix P1 — age edits have a conflict check, and «Editar» checks every field before saving any', () => {
    it('changeProfileAge with the age shown when the form opened: a different stored age → conflict, nothing written', async () => {
        expect(await as(OWNER, () => changeProfileAge({ adopterId: 'pedro', age: 40, isMinor: false }))).toMatchObject({ ok: true });
        const before = pedro();
        expect(await changeProfileAge({ adopterId: 'pedro', age: 41, isMinor: false, expected: { age: 30, isMinor: false } }))
            .toEqual({ ok: false, error: 'conflict' });
        expect(pedro()).toMatchObject({ age: before.age, age_as_of: before.age_as_of, is_minor: before.is_minor });
        // The age shown is the stored one → saved.
        expect(await changeProfileAge({ adopterId: 'pedro', age: 41, isMinor: false, expected: { age: 40, isMinor: false } })).toMatchObject({ ok: true, age: 41 });
        // The box with no age is part of what was shown.
        // (Lucas: no age, box off. The form showed the box on — someone unticked it since.)
        expect(await changeProfileAge({ adopterId: 'lucas', age: 15, isMinor: true, expected: { age: null, isMinor: true } })).toEqual({ ok: false, error: 'conflict' });
    });

    it('checkHouseholdPersonEdit names the fields changed since the form opened (never their values); signed out is refused', async () => {
        expect(await as(OWNER, () => changeProfileAge({ adopterId: 'lucas', age: 12, isMinor: true }))).toMatchObject({ ok: true });
        const shown = { name: 'Lucas Paez', age: 12, isMinor: true };
        expect(await checkHouseholdPersonEdit({ profileId: 'lucas', expected: shown })).toEqual({ ok: true, conflicts: [] });
        await as(MATE, () => changeProfileName({ adopterId: 'lucas', name: 'Lucas A. Paez', expectedName: 'Lucas Paez' }));
        await as(MATE, () => changeProfileAge({ adopterId: 'lucas', age: 13, isMinor: true }));
        const res = await checkHouseholdPersonEdit({ profileId: 'lucas', expected: shown });
        expect(res).toEqual({ ok: true, conflicts: ['name', 'age'] });
        expect(JSON.stringify(res)).not.toContain('Lucas A.');
        expect(await as(null, () => checkHouseholdPersonEdit({ profileId: 'lucas', expected: shown }))).toEqual({ ok: false, error: 'not_authenticated' });
        expect(await checkHouseholdPersonEdit({ profileId: 'nobody', expected: shown })).toEqual({ ok: false, error: 'not_found' });
    });
});
