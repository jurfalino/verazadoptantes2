/**
 * Identity verdict, Task 5 — the golden table: every surface that looks for
 * people, called as its screen calls it, on the same nine examples, over real
 * SQL (every drizzle/*.sql replayed) and the real token index / duplicate engine.
 *
 * Today's behavior is pinned for surfaces not yet on the verdict; each rollout
 * step flips its own column (spec §Rollout). Only the sheet wizard is on the
 * verdict. Assert profile ids and actions only, never percentages.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';

const { state } = vi.hoisted(() => ({ state: { db: null as unknown } }));

vi.mock('@/app/actions/_db', () => ({ getDb: async () => state.db, getUser: async () => 'rescuer@example.com' }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/lib/requestContext', () => ({ getRequestContext: () => ({ env: {} }) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/background', () => ({ runAfterResponse: vi.fn(async (_n: string, task: () => Promise<unknown>) => { await task(); }) }));
vi.mock('@/lib/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') },
    generateErrorId: () => 'gen12345',
    withTrace: (_op: string, fn: () => unknown) => fn(),
}));

import { tokenizeAdopter } from './adopterTokenize';
import { contactEntriesToBlob, type ContactEntry } from './contactEntries';
import { matchImportRow } from '@/app/actions/importIdentityMatches';
import { findAdopters, findAdoptersAsViewer } from '@/app/actions/findAdopters';
import { searchFormDuplicates } from './formDuplicates';
import { fuzzyQueryOf } from './api/search';
import { checkSearchRules, type SearchRequest } from './api/schemas';
import { findIdentifierHits } from './api/profiles';
import { decideExactOutcome } from '@/domain/apiExactMatch';
import { dupHintSearchInput } from '@/domain/dupHint';
import { defaultImportAction } from '@/domain/importMerge';
import { confidenceBand } from './scoring';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Row[] } };
const OWNER = 'rescuer@example.com';

const e = (type: ContactEntry['type'], value: string, platform?: string): ContactEntry =>
    ({ id: `${type}-${value}`, type, value, ...(platform ? { platform } : {}), addedBy: OWNER } as ContactEntry);

async function seed(id: string, name: string, entries: ContactEntry[]) {
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, country, created_at, updated_at, contact_entries, contact_info)
        VALUES (?, ?, '5', ?, 'AR', 1000, 1000, ?, ?)`)
        .run(id, name, OWNER, JSON.stringify(entries), contactEntriesToBlob(entries));
    await tokenizeAdopter(id);
}

beforeEach(async () => {
    vi.clearAllMocks();
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as typeof sqlite;
    await seed('mj', 'María José Pérez', [
        e('phone', '+54 9 11 6585 1333'), e('email', 'maria.perez@gmail.com'), e('id', '30123456'), e('social', 'mariajose.p', 'instagram'),
    ]);
    await seed('mp', 'María Pérez', [e('phone', '+54 9 11 4444 5555')]);
    await seed('jg', 'Juan Gómez', [e('phone', '+54 9 11 7777 8888'), e('id', '00000000')]);
    for (const [id, n] of [['lu1', 'Beto Sosa'], ['lu2', 'Carla Díaz'], ['lu3', 'Darío Vega'], ['lu4', 'Elsa Ortiz']]) {
        await seed(id, n, [e('email', 'luis@x.com')]);
    }
});

interface Person {
    name: string;
    phone?: string;
    email?: string;
    social?: string;      // bare handle (Instagram)
    dni?: string;
}

/** Every surface, called exactly as its screen calls it today. Ids only. */
async function surfaces(p: Person) {
    const phones = p.phone ? [p.phone] : [];
    const emails = p.email ? [p.email] : [];
    const ids = p.dni ? [p.dni] : [];

    // Sheet (the verdict): matchImportRow → defaultImportAction + matches.
    const sheetRes = await matchImportRow({
        name: p.name, phones, emails, documentIds: ids,
        socials: p.social ? [`instagram.com/${p.social}`] : [],
    });
    if (!sheetRes.ok) throw new Error('matchImportRow failed');
    const sheet = { action: defaultImportAction(sheetRes.matches), matches: sheetRes.matches.map(m => m.adopterId) };

    // Form family.
    const form = (await searchFormDuplicates(
        { name: p.name, phones, emails, socials: p.social ? [p.social] : [] }, { minRelevance: 15 }, async () => OWNER,
    )).results.map(r => r.adopter.id);

    // Social-post import: contact blob; pre-selected iff the top match is in the «high» band.
    const entries: ContactEntry[] = [
        ...(p.phone ? [e('phone', p.phone)] : []),
        ...(p.email ? [e('email', p.email)] : []),
        ...(p.social ? [e('social', p.social, 'instagram')] : []),
        ...(p.dni ? [e('id', p.dni)] : []),
    ];
    const post = await findAdopters({ name: p.name, contactInfo: contactEntriesToBlob(entries) }, { mode: 'duplicate' });
    const postList = post.results as Array<{ adopterId: string; relevancePercent: number }>;
    const postImport = { listed: postList.map(r => r.adopterId), preselected: postList.length > 0 && confidenceBand(postList[0].relevancePercent) === 'high' };

    // «Ya existe en otro perfil» on the first contact: phone, email, social, id.
    const first = p.phone ? ['phone', p.phone] : p.email ? ['email', p.email] : p.social ? ['social', p.social] : p.dni ? ['id', p.dni] : null;
    const hintInput = first ? dupHintSearchInput(first[0], first[1]) : null;
    const warning = hintInput
        ? ((await findAdopters(hintInput, { mode: 'duplicate', limit: 3, minRelevance: 5 })).results as Array<{ adopterId: string }>).map(r => r.adopterId)
        : null;

    // «Pendientes»: pairs at relevance >= 30.
    const pend = await findAdopters(
        { name: p.name, phones, ids, emails, socials: p.social ? [p.social] : [] },
        { mode: 'duplicate', minRelevance: 0, limit: 5 },
    );
    const pendientes = (pend.results as Array<{ adopterId: string; relevancePercent: number }>).filter(r => r.relevancePercent >= 30).map(r => r.adopterId);

    // API exact: rules first, then identifier lookup + decision.
    const person: SearchRequest['person'] = {
        fullName: p.name,
        ...(p.email ? { email: p.email } : {}),
        ...(p.phone ? { phone: p.phone } : {}),
        ...(p.dni ? { documentId: { type: 'dni', value: p.dni } } : {}),
        ...(p.social ? { socials: [{ platform: 'instagram', handle: p.social }] } : {}),
    } as SearchRequest['person'];
    let apiExact: unknown;
    const problems = checkSearchRules({ mode: 'exact', person, activity: { type: 'adoption_request', externalId: 'golden-1' } } as unknown as SearchRequest);
    if (problems.length > 0) apiExact = { rejected: problems[0].code };
    else {
        const hits = await findIdentifierHits(state.db as Parameters<typeof findIdentifierHits>[0], person, 'req', 'AR');
        const o = decideExactOutcome(p.name, hits.candidates);
        apiExact = o.result === 'found' ? { found: o.profileId }
            : o.result === 'not_found' ? { not_found: true }
            : { ambiguous: o.reason };
    }

    // Search box / API fuzzy: main list vs low-relevance list.
    const s = await findAdoptersAsViewer({ raw: fuzzyQueryOf(person) }, { enrich: true }, OWNER);
    const search = { main: s.results.map(r => r.adopterId), low: (s.lowRelevanceResults ?? []).map(r => r.adopterId) };

    return { sheet, form, postImport, warning, pendientes, apiExact, search };
}

/**
 * One row per example. `sheet` is the verdict (new); everything else is TODAY.
 * `search.low` lists only the profile the table names (the low list may carry
 * unrelated weak name hits, which are not part of the contract).
 */
const MJ = 'mj';
const MP = 'mp';

interface Expected {
    sheet: { action: 'upsert' | 'review' | 'create'; matches: string[] };
    form: string[]; postListed: string[]; postPreselected: false; warning: string[] | null; pendientes: string[];
    apiExact: unknown; searchMain: string[]; searchLowHas: string[];
}

const CASES: Array<{ n: number; label: string; person: Person; sheetOnly?: true; extraSeed?: Array<[string, string, ContactEntry[]]>; expected: Expected | { sheet: Expected['sheet'] } }> = [
    { n: 1, label: 'María Pérez + MJ phone', person: { name: 'María Pérez', phone: '11 6585-1333' }, expected: {
        sheet: { action: 'upsert', matches: [MJ, MP] }, form: [MJ], postListed: [MJ], postPreselected: false, warning: [MJ],
        pendientes: [MJ], apiExact: { found: MJ }, searchMain: [MJ], searchLowHas: [] } },
    { n: 2, label: 'Juan Carlos Ruiz + MJ phone', person: { name: 'Juan Carlos Ruiz', phone: '11 6585-1333' }, expected: {
        sheet: { action: 'review', matches: [MJ] }, form: [MJ], postListed: [MJ], postPreselected: false, warning: [MJ],
        pendientes: [MJ], apiExact: { ambiguous: 'name_mismatch' }, searchMain: [MJ], searchLowHas: [] } },
    { n: 3, label: 'María José Pérez + another phone', person: { name: 'María José Pérez', phone: '11 2222-3333' }, expected: {
        sheet: { action: 'review', matches: [MJ, MP] }, form: [], postListed: [], postPreselected: false, warning: [],
        pendientes: [], apiExact: { not_found: true }, searchMain: [], searchLowHas: [MJ] } },
    { n: 4, label: 'María José Pérez, no contact', person: { name: 'María José Pérez' }, expected: {
        sheet: { action: 'review', matches: [MJ, MP] }, form: [MJ, MP], postListed: [MJ, MP], postPreselected: false, warning: null,
        pendientes: [MJ], apiExact: { rejected: 'exact_requires_name_and_identifier' }, searchMain: [MJ], searchLowHas: [] } },
    { n: 5, label: 'Majo Pérez + MJ Instagram', person: { name: 'Majo Pérez', social: 'mariajose.p' }, expected: {
        sheet: { action: 'review', matches: [MJ] }, form: [MJ], postListed: [], postPreselected: false, warning: [MJ],
        pendientes: [MJ], apiExact: { rejected: 'exact_requires_name_and_identifier' }, searchMain: [], searchLowHas: [MJ] } },
    { n: 6, label: 'Maria Peres + MJ email', person: { name: 'Maria Peres', email: 'maria.perez@gmail.com' }, expected: {
        sheet: { action: 'upsert', matches: [MJ, MP] }, form: [MJ], postListed: [MJ], postPreselected: false, warning: [MJ],
        pendientes: [MJ], apiExact: { found: MJ }, searchMain: [], searchLowHas: [MJ] } },
    { n: 7, label: 'Majo Pérez + MJ DNI', person: { name: 'Majo Pérez', dni: '30.123.456' }, expected: {
        sheet: { action: 'upsert', matches: [MJ] }, form: [], postListed: [MJ], postPreselected: false, warning: [MJ],
        pendientes: [MJ], apiExact: { ambiguous: 'name_mismatch' }, searchMain: [], searchLowHas: [MJ] } },
    { n: 8, label: 'Ana Ruiz + DNI shared with Juan Gómez', person: { name: 'Ana Ruiz', dni: '00000000' }, sheetOnly: true,
        expected: { sheet: { action: 'create', matches: [] } } },
    { n: 9, label: 'Luis Paz + email held by four other names', person: { name: 'Luis Paz', email: 'luis@x.com' }, sheetOnly: true,
        expected: { sheet: { action: 'create', matches: [] } } },
    { n: 10, label: 'Gómez + phone shared by Ana Gómez and Juan Gómez', person: { name: 'Gómez', phone: '11 5000-1000' }, sheetOnly: true,
        extraSeed: [['ag', 'Ana Gómez', [e('phone', '+54 9 11 5000 1000')]], ['jg2', 'Juan Gómez', [e('phone', '+54 9 11 5000 1000')]]],
        expected: { sheet: { action: 'review', matches: ['ag', 'jg2'] } } },
];

describe('golden table: every surface on the same examples', () => {
    for (const c of CASES) {
        it(`${c.n}. ${c.label}`, async () => {
            for (const [id, name, entries] of c.extraSeed ?? []) await seed(id, name, entries);
            const got = await surfaces(c.person);
            if (c.extraSeed) expect(got.sheet.matches).toHaveLength(c.expected.sheet.matches.length);
            expect(c.extraSeed ? { ...got.sheet, matches: [...got.sheet.matches].sort() } : got.sheet)
                .toEqual(c.extraSeed ? { ...c.expected.sheet, matches: [...c.expected.sheet.matches].sort() } : c.expected.sheet);
            if (c.sheetOnly) return;
            const x = c.expected as Expected;
            expect(got.form).toEqual(x.form);
            expect(got.postImport.listed).toEqual(x.postListed);
            expect(got.postImport.preselected).toBe(x.postPreselected);
            expect(got.warning).toEqual(x.warning);
            expect(got.pendientes).toEqual(x.pendientes);
            expect(got.apiExact).toEqual(x.apiExact);
            expect(got.search.main).toEqual(x.searchMain);
            expect(got.search.low).toEqual(expect.arrayContaining(x.searchLowHas));
        });
    }
});
