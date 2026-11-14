/**
 * Group branding resolution (Review Focus #1 forged hint, #2 left group, #5
 * lookup failure): a public page only ever carries the branding of a group
 * the rescuer belongs to, and a failure means today's look — never a throw.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { warn, flag, effective } = vi.hoisted(() => ({
    warn: vi.fn(),
    flag: vi.fn(async () => true),
    effective: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({ logger: { warn, error: vi.fn(() => 'err12345'), info: vi.fn(), debug: vi.fn() } }));
vi.mock('@/config/features', () => ({ getFeatureFlag: flag }));
vi.mock('@/lib/adoptionDocsRepo', () => ({ getEffectiveDocsSource: effective }));

import { resolveBrandingForRescuer, resolveBrandingForOrgSlug, getOrgBranding } from './groupBrandingRepo';

type Row = Record<string, unknown>;
const org = (id: string, slug: string, extra: Row = {}): Row => ({
    id, name: `Grupo ${id}`, slug, logoUrl: null, bannerUrl: null, brandTheme: null, brandAccent: null,
    instagramUrl: null, facebookUrl: null, websiteUrl: null, ...extra,
});

/** A fake drizzle `select().from().where(eq(col, value)).get()` over an in-memory organizations table. */
function fakeDb(rows: Row[], opts: { fail?: boolean } = {}) {
    const db = {
        select: (cols: Record<string, unknown>) => ({
            from: () => ({
                where: (cond: { queryChunks: unknown[] }) => ({
                    get: async () => {
                        if (opts.fail) throw new Error('D1 down');
                        const chunks = cond.queryChunks as Array<Record<string, unknown>>;
                        const col = chunks.find(q => q && typeof q === 'object' && 'columnType' in q)?.name as string;
                        const val = chunks.find(q => q && typeof q === 'object' && 'encoder' in q)?.value;
                        const row = rows.find(r => r[col] === val);
                        if (!row) return undefined;
                        return Object.fromEntries(Object.keys(cols).map(k => [k, row[k] ?? null]));
                    },
                }),
            }),
        }),
    };
    return db as unknown as Parameters<typeof resolveBrandingForRescuer>[0];
}

const BRANDED = org('A', 'grupo-a', { brandTheme: 'light', brandAccent: 'naranja', logoUrl: 'https://r2/a.png' });
const BRANDED_B = org('B', 'grupo-b', { brandAccent: 'verde' });
const PLAIN = org('P', 'grupo-plain');
const db = fakeDb([BRANDED, BRANDED_B, PLAIN]);

beforeEach(() => {
    warn.mockClear();
    flag.mockReset(); flag.mockResolvedValue(true);
    effective.mockReset();
});

describe('resolveBrandingForRescuer', () => {
    it('the effective group\'s branding', async () => {
        effective.mockResolvedValue({ source: { type: 'org', orgId: 'A' }, memberOrgIds: ['A'] });
        expect(await resolveBrandingForRescuer(db, 'r@example.com')).toMatchObject({
            orgName: 'Grupo A', orgSlug: 'grupo-a', theme: 'light', accentId: 'naranja', logoUrl: 'https://r2/a.png',
        });
    });

    it('a hint of a group the rescuer belongs to wins over their chosen group', async () => {
        effective.mockResolvedValue({ source: { type: 'org', orgId: 'A' }, memberOrgIds: ['A', 'B'] });
        expect((await resolveBrandingForRescuer(db, 'r@example.com', 'grupo-b'))?.orgSlug).toBe('grupo-b');
    });

    it('a forged hint (a group the rescuer is not in) is ignored', async () => {
        effective.mockResolvedValue({ source: { type: 'org', orgId: 'A' }, memberOrgIds: ['A'] });
        expect((await resolveBrandingForRescuer(db, 'r@example.com', 'grupo-b'))?.orgSlug).toBe('grupo-a');
        effective.mockResolvedValue({ source: { type: 'self' }, memberOrgIds: ['A'] });
        expect(await resolveBrandingForRescuer(db, 'r@example.com', 'grupo-b')).toBeNull();
    });

    it('a chosen group the rescuer has left → no branding', async () => {
        effective.mockResolvedValue({ source: { type: 'org', orgId: 'A' }, memberOrgIds: [] });
        expect(await resolveBrandingForRescuer(db, 'r@example.com')).toBeNull();
    });

    it('«Los míos», a group with nothing set, or a deleted group → null', async () => {
        effective.mockResolvedValue({ source: { type: 'self' }, memberOrgIds: ['A'] });
        expect(await resolveBrandingForRescuer(db, 'r@example.com')).toBeNull();
        effective.mockResolvedValue({ source: { type: 'org', orgId: 'P' }, memberOrgIds: ['P'] });
        expect(await resolveBrandingForRescuer(db, 'r@example.com')).toBeNull();
        effective.mockResolvedValue({ source: { type: 'org', orgId: 'GONE' }, memberOrgIds: ['GONE'] });
        expect(await resolveBrandingForRescuer(db, 'r@example.com')).toBeNull();
    });

    it('flag off → null without touching the DB', async () => {
        flag.mockResolvedValue(false);
        expect(await resolveBrandingForRescuer(db, 'r@example.com')).toBeNull();
        expect(effective).not.toHaveBeenCalled();
    });

    it('no rescuer / anonymous → null', async () => {
        expect(await resolveBrandingForRescuer(db, null)).toBeNull();
        expect(await resolveBrandingForRescuer(db, 'anonymous')).toBeNull();
        expect(effective).not.toHaveBeenCalled();
    });

    it('a DB failure → null and a warn with the email masked, never a throw', async () => {
        effective.mockRejectedValue(new Error('D1 down'));
        await expect(resolveBrandingForRescuer(db, 'rescatista@example.com', 'grupo-a')).resolves.toBeNull();
        expect(warn).toHaveBeenCalledTimes(1);
        const [, ctx] = warn.mock.calls[0] as unknown as [string, Record<string, unknown>];
        expect(ctx.error).toBe('D1 down');
        expect(JSON.stringify(ctx)).not.toContain('rescatista@example.com');
        expect(ctx.rescuer).toBeTruthy();
    });

    it('a failing org lookup → null + warn', async () => {
        effective.mockResolvedValue({ source: { type: 'org', orgId: 'A' }, memberOrgIds: ['A'] });
        await expect(resolveBrandingForRescuer(fakeDb([], { fail: true }), 'r@example.com')).resolves.toBeNull();
        expect(warn).toHaveBeenCalled();
    });

    // Final review M1: the public form reads the flag and the effective source once per request.
    it('uses the flag and the shared effective-source lookup the caller passes, reading neither again', async () => {
        const shared = vi.fn(async () => ({ source: { type: 'org', orgId: 'A' } as const, memberOrgIds: ['A'] }));
        expect((await resolveBrandingForRescuer(db, 'r@example.com', null, { brandingOn: true, effective: shared }))?.orgSlug).toBe('grupo-a');
        expect(shared).toHaveBeenCalledTimes(1);
        expect(flag).not.toHaveBeenCalled();
        expect(effective).not.toHaveBeenCalled();
    });
    it('a passed brandingOn=false → null without any lookup', async () => {
        const shared = vi.fn();
        expect(await resolveBrandingForRescuer(db, 'r@example.com', 'grupo-a', { brandingOn: false, effective: shared })).toBeNull();
        expect(shared).not.toHaveBeenCalled();
        expect(flag).not.toHaveBeenCalled();
    });
    it('a shared lookup that rejects → null + warn, never a throw', async () => {
        const shared = vi.fn(async () => { throw new Error('D1 down'); });
        await expect(resolveBrandingForRescuer(db, 'r@example.com', null, { brandingOn: true, effective: shared })).resolves.toBeNull();
        expect(warn).toHaveBeenCalledTimes(1);
    });
    it('without a shared lookup it tells getEffectiveDocsSource the flag is on (no second flag read there)', async () => {
        effective.mockResolvedValue({ source: { type: 'org', orgId: 'A' }, memberOrgIds: ['A'] });
        await resolveBrandingForRescuer(db, 'r@example.com');
        expect(effective).toHaveBeenCalledWith(db, 'r@example.com', { brandingOn: true });
        expect(flag).toHaveBeenCalledTimes(1);
    });
});

describe('resolveBrandingForOrgSlug', () => {
    it('that group, whatever its members chose', async () => {
        expect(await resolveBrandingForOrgSlug(db, 'grupo-b')).toMatchObject({ orgSlug: 'grupo-b', theme: 'dark', accentId: 'verde' });
    });
    it('unknown slug, nothing set, flag off → null', async () => {
        expect(await resolveBrandingForOrgSlug(db, 'nope')).toBeNull();
        expect(await resolveBrandingForOrgSlug(db, 'grupo-plain')).toBeNull();
        flag.mockResolvedValue(false);
        expect(await resolveBrandingForOrgSlug(db, 'grupo-a')).toBeNull();
    });
    it('a DB failure → null + warn, never a throw', async () => {
        await expect(resolveBrandingForOrgSlug(fakeDb([], { fail: true }), 'grupo-a')).resolves.toBeNull();
        expect(warn).toHaveBeenCalled();
    });
    it('a passed brandingOn skips the flag read', async () => {
        expect((await resolveBrandingForOrgSlug(db, 'grupo-a', { brandingOn: true }))?.orgSlug).toBe('grupo-a');
        expect(await resolveBrandingForOrgSlug(db, 'grupo-a', { brandingOn: false })).toBeNull();
        expect(flag).not.toHaveBeenCalled();
    });
});

describe('getOrgBranding', () => {
    it('defaults for an unbranded group, null for a missing one', async () => {
        expect(await getOrgBranding(db, 'P')).toMatchObject({ orgName: 'Grupo P', theme: 'dark', accentId: 'violeta', logoUrl: null });
        expect(await getOrgBranding(db, 'X')).toBeNull();
    });
});
