/**
 * P2 (Jon, 2026-11-08): the interested-people panel shows the person's ALERTS
 * with the full profile's pills and words, and says «Sin alertas en el perfil»
 * only when the lookup really ran and found none. A failed lookup shows no
 * alerts line at all — never a claim that there are none.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { es } from '@/i18n/locales/es';
import type { ApplicantSummary } from '@/app/actions/applicants';

const tFor = (dict: Record<string, unknown>) => (path: string): string => {
    let cur: unknown = dict;
    for (const k of path.split('.')) cur = (cur as Record<string, unknown> | undefined)?.[k];
    return typeof cur === 'string' ? cur : path;
};
const t = tFor(es as unknown as Record<string, unknown>);

vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ t, locale: 'es' }) }));
vi.mock('@/context/TimezoneContext', () => ({ useDateFormat: () => ({ formatShortDate: () => '' }) }));
vi.mock('@/components/ui/Toast', () => ({ useShowToast: () => ({ error: vi.fn() }) }));
vi.mock('@/app/actions/contract', () => ({ createContractInvitation: vi.fn() }));
vi.mock('@/lib/clientErrorReporter', () => ({ resolveErrorId: vi.fn(() => 'err12345'), reportClientError: vi.fn() }));
vi.mock('@/lib/zaraz', () => ({ zarazTrack: vi.fn() }));
vi.mock('@/components/LocationMap', () => ({ default: () => null }));
vi.mock('@/components/FormAnswersPanel', () => ({ default: () => null }));
vi.mock('@/components/FormPhotos', () => ({ default: () => null }));

const { default: ApplicantDetailPanel } = await import('./ApplicantDetailPanel');

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const NO_FLAGS = { inaccurate: false, duplicate: false, systemDuplicate: false, verified_identity: false, verified_address: false, tooManyAdoptions: null, tooManyRequests: null };

const applicant = (o: Partial<ApplicantSummary> = {}): ApplicantSummary => ({
    submissionId: 's1', adopterId: 'juan', adopterName: 'Juan Pérez', adopterRating: null, appliedAt: null,
    hasInvite: false, isSigned: false, flags: NO_FLAGS, alertsChecked: true, housemateAlert: { lowRating: null, hasAlerts: false },
    adoptionCount: 3, requestCount: 0, intent: null, species: null, lifeStage: null,
    submission: { email: null, phone: null, address: null, selfieUrl: null, photos: { protection: [], sleep: null }, latitude: null, longitude: null, household: null, answersJson: null },
    adopterContext: null, ...o,
});
const render = (a: ApplicantSummary) => renderToStaticMarkup(
    <ApplicantDetailPanel applicants={[a]} initialIndex={0} animalId="luna" animalName="Luna" onClose={() => {}} />,
);
const NONE = es.myAnimals.applicants_panel_no_flags;

describe('ApplicantDetailPanel — the person\'s alerts (P2)', () => {
    it('3 adoptions in 10 days: the profile\'s alert pill, and no «Sin alertas»', () => {
        const html = render(applicant({ flags: { ...NO_FLAGS, tooManyAdoptions: { count: 3, threshold: 3, periodDays: 90, actualSpanDays: 10 } } }));
        expect(html).toContain('data-alert="too_many_adoptions"');
        expect(text(html)).toContain(es.alerts.too_many_adoptions.replace('{count}', '3').replace('{days}', '10'));
        expect(text(html)).not.toContain(NONE);
    });

    it('the housemate chips, with the profile\'s words', () => {
        const html = render(applicant({ housemateAlert: { lowRating: 2, hasAlerts: true } }));
        expect(html).toContain('data-alert="housemate_low_rating"');
        expect(html).toContain('data-alert="housemate_alerts"');
        expect(text(html)).toContain(es.alerts.housemate_low_rating.replace('{rating}', '2.0'));
        expect(text(html)).not.toContain(NONE);
    });

    it('checked and none found: «Sin alertas en el perfil»', () => {
        expect(text(render(applicant()))).toContain(NONE);
    });

    it('the lookup failed: no alerts line — never «Sin alertas»', () => {
        const html = render(applicant({ alertsChecked: false }));
        expect(text(html)).not.toContain(NONE);
        expect(html).not.toContain('data-alert=');
    });

    it('a flag is not an alert: «Duplicado» still shows, and so does «Sin alertas» when no alert was found', () => {
        const html = render(applicant({ flags: { ...NO_FLAGS, duplicate: true, verified_identity: true } }));
        expect(html).toContain('data-flag="duplicate"');
        expect(text(html)).toContain(es.flags.verified_identity);
        expect(text(html)).toContain(NONE);
    });
});
