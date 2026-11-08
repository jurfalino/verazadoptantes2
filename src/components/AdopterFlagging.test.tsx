/**
 * The profile header's housemate alerts (Jon 2026-11-01; review fixes 3 and 7):
 * «Conviviente con calificación {rating}» and «Conviviente con alertas» sit in
 * the header's alert row, after the person's own alerts and before the flags,
 * and are LINKS to «Familiares / Convivientes» (so focus can go there too).
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { es } from '@/i18n/locales/es';

const tFor = (dict: Record<string, unknown>) => (path: string): string => {
    let cur: unknown = dict;
    for (const k of path.split('.')) cur = (cur as Record<string, unknown> | undefined)?.[k];
    return typeof cur === 'string' ? cur : path;
};
const t = tFor(es as unknown as Record<string, unknown>);

vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ t, locale: 'es' }) }));
vi.mock('@/context/TimezoneContext', () => ({ useDateFormat: () => ({ formatShortDate: () => '' }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: null }) }));
vi.mock('@/context/AuthContext', () => ({ useAuthContext: () => ({ openLogin: vi.fn() }) }));
vi.mock('@/components/ui/Toast', () => ({ useShowToast: () => vi.fn() }));
vi.mock('@/app/actions', () => ({ flagAdopter: vi.fn(), findAdopters: vi.fn(), getDuplicateCandidates: vi.fn(async () => []) }));
vi.mock('@/components/MatchCompare', () => ({ default: () => null }));
vi.mock('@/lib/clientErrorReporter', () => ({ resolveErrorId: vi.fn(() => 'err12345'), reportClientError: vi.fn() }));
vi.mock('@/lib/zaraz', () => ({ zarazTrack: vi.fn() }));

const { AdopterFlagging, HOUSEHOLD_SECTION_HREF } = await import('./AdopterFlagging');

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const duplicateFlag = { id: 'f1', reason: 'duplicate', details: null, targetAdopterId: 'other', flaggedBy: 'x@example.org' };
const render = (props: Partial<Parameters<typeof AdopterFlagging>[0]> = {}) => renderToStaticMarkup(
    <AdopterFlagging adopterId="a1" adopterName="Ana" existingFlags={[]} {...props} />,
);

describe('AdopterFlagging — the header\'s housemate chips', () => {
    it('a low-rated housemate: «Conviviente con calificación 2.0», a link to the section', () => {
        const html = render({ housemateAlert: { lowRating: 2, hasAlerts: false } });
        expect(text(html)).toContain('Conviviente con calificación 2.0');
        expect(html).toMatch(new RegExp(`<a href="${HOUSEHOLD_SECTION_HREF}"[^>]*data-testid="profile-housemate-alert-rating"`));
        expect(html).not.toContain('profile-housemate-alert-alerts');
        expect(HOUSEHOLD_SECTION_HREF).toBe('#profile-household-section');
    });

    it('both chips, after the person\'s own alerts and before their flags', () => {
        const html = render({
            housemateAlert: { lowRating: 1.45, hasAlerts: true },
            tooManyAdoptions: { count: 4, periodDays: 90, actualSpanDays: 10 },
            existingFlags: [duplicateFlag],
        });
        const own = html.indexOf('data-alert="too_many_adoptions"');
        const low = html.indexOf('data-testid="profile-housemate-alert-rating"');
        const alerts = html.indexOf('data-testid="profile-housemate-alert-alerts"');
        const flag = html.indexOf('data-flag="duplicate"');
        expect(own).toBeGreaterThan(-1);
        expect(own).toBeLessThan(low);
        expect(low).toBeLessThan(alerts);
        expect(alerts).toBeLessThan(flag);
        // One decimal, as every rating is written (formatRating).
        expect(text(html)).toContain('Conviviente con calificación 1.4');
        expect(text(html)).toContain('Conviviente con alertas');
    });

    it('no housemate problem (or none known: a signed-out viewer) → no chip', () => {
        for (const housemateAlert of [undefined, { lowRating: null, hasAlerts: false }]) {
            expect(render({ housemateAlert })).not.toContain('profile-housemate-alert');
        }
    });
});

/** V2: the header draws «Dirección Verificada» too — decided by the caller with profileVerifications, like identity. */
describe('AdopterFlagging — the verification badges', () => {
    it('«Dirección Verificada» shows when the records verify the address', () => {
        const html = text(render({ verifiedAddress: true }));
        expect(html).toContain(es.flags.addr_verified);
        expect(html).not.toContain(es.flags.id_verified);
    });
    it('both badges when both are verified; none when neither is (a stored mark alone decides nothing here)', () => {
        const both = text(render({ verifiedIdentity: true, verifiedAddress: true }));
        expect(both).toContain(es.flags.id_verified);
        expect(both).toContain(es.flags.addr_verified);
        const none = text(render({ existingFlags: [{ id: 'f2', reason: 'verified_address', details: 'Address verified during pet delivery: x' }] }));
        expect(none).not.toContain(es.flags.addr_verified);
    });
});
