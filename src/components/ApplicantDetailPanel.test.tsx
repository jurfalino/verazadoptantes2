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
vi.mock('@/context/TimezoneContext', () => ({ useDateFormat: () => ({ formatShortDate: (s: number) => (s === SENT_AT ? '9 nov' : s === REPLACED_AT ? '8 nov' : s === DECLINED_AT ? '10 nov' : '') }) }));
vi.mock('@/components/ui/Toast', () => ({ useShowToast: () => ({ error: vi.fn() }) }));
vi.mock('@/app/actions/contract', () => ({ createContractInvitation: vi.fn() }));
vi.mock('@/lib/clientErrorReporter', () => ({ resolveErrorId: vi.fn(() => 'err12345'), reportClientError: vi.fn() }));
vi.mock('@/lib/zaraz', () => ({ zarazTrack: vi.fn() }));
vi.mock('@/components/LocationMap', () => ({ default: () => null }));
// «Todas las respuestas» itself is not under test here; its rows and labels are (the answers summary uses them).
vi.mock('@/components/FormAnswersPanel', async (orig) => ({ ...(await orig<typeof import('@/components/FormAnswersPanel')>()), default: () => null }));
vi.mock('@/components/FormPhotos', () => ({ default: () => null }));
vi.mock('@/app/actions/applications', () => ({ declineApplication: vi.fn(), proposeAnimal: vi.fn(), getProposalAnimals: vi.fn(), getApplicationDuplicates: vi.fn() }));
vi.mock('@/app/actions/formSubmission', () => ({ linkFormToExistingAdopter: vi.fn() }));
vi.mock('@/app/actions/duplicates', () => ({ dismissDuplicateCandidate: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/app/actions', () => ({ getMatchContext: vi.fn(async () => ({ ok: false })) }));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: null }) }));

const SENT_AT = 1_762_700_000;
const REPLACED_AT = 1_762_600_000;
const DECLINED_AT = 1_762_800_000;

const { default: ApplicantDetailPanel, indexAfterOutcome } = await import('./ApplicantDetailPanel');

const text = (html: string) => html.replace(/<wbr\s*\/?>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const NO_FLAGS = { inaccurate: false, duplicate: false, systemDuplicate: false, verified_identity: false, verified_address: false, tooManyAdoptions: null, tooManyRequests: null };

const applicant = (o: Partial<ApplicantSummary> = {}): ApplicantSummary => ({
    applicationId: 'app-s1', origin: 'form', status: { kind: 'to_evaluate', note: null }, askedAnimal: null, outcomeAnimal: null,
    submissionId: 's1', adopterId: 'juan', adopterName: 'Juan Pérez', adopterRating: null, appliedAt: null,
    hasInvite: false, isSigned: false, flags: NO_FLAGS, alertsChecked: true, housemateAlert: { lowRating: null, hasAlerts: false },
    adoptionCount: 3, requestCount: 0, intent: null, species: null, lifeStage: null,
    submission: { email: null, phone: null, address: null, selfieUrl: null, photos: { protection: [], sleep: null }, latitude: null, longitude: null, household: null, answersJson: null },
    adopterContext: null, ...o,
});
const LUNA = { id: 'luna', name: 'Luna', sex: 'hembra' };
const render = (a: ApplicantSummary, o: { animal?: typeof LUNA | null; returnLabel?: boolean } = {}) => renderToStaticMarkup(
    <ApplicantDetailPanel applicants={[a]} initialIndex={0} animal={o.animal === undefined ? LUNA : o.animal} returnLabel={o.returnLabel} onClose={() => {}} />,
);
const has = (html: string, id: string) => html.includes(`data-testid="${id}"`);
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

    it('part of the lookup failed: what was read still shows, and no «Sin alertas»', () => {
        const html = render(applicant({ alertsChecked: false, flags: { ...NO_FLAGS, tooManyAdoptions: { count: 3, threshold: 3, periodDays: 90, actualSpanDays: 10 } } }));
        expect(html).toContain('data-alert="too_many_adoptions"');
        expect(text(html)).not.toContain(NONE);
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

describe('ApplicantDetailPanel — the evaluation (outcome, footer, answers)', () => {
    const E = es.evaluation;

    it('to_evaluate on an animal: footer «No avanzar» + «Enviar contrato»; no status line', () => {
        const html = render(applicant());
        expect(has(html, 'evaluate-decline')).toBe(true);
        expect(has(html, 'evaluate-send-contract')).toBe(true);
        expect(has(html, 'evaluate-propose')).toBe(false);
        expect(text(html)).toContain(E.decline);
        expect(text(html)).toContain(es.myAnimals.applicants_send_contract);
        expect(has(html, 'applicant-status-line')).toBe(false);
    });

    it('contract_sent: «Contrato enviado el 9 nov» + «No avanzar» + «Reenviar contrato»', () => {
        const html = render(applicant({ status: { kind: 'contract_sent', sentAt: SENT_AT }, hasInvite: true }));
        expect(has(html, 'applicant-status-line')).toBe(true);
        expect(text(html)).toContain('Contrato enviado el 9 nov');
        expect(has(html, 'evaluate-decline')).toBe(true);
        expect(has(html, 'evaluate-send-contract')).toBe(true);
        expect(text(html)).toContain(es.myAnimals.applicants_resend);
    });

    it('general to_evaluate: «Prefiere: …» at the top, footer «No avanzar» + «Proponer un animal»', () => {
        const html = render(applicant({ species: 'cat', lifeStage: 'puppy', submission: { ...applicant().submission, answersJson: JSON.stringify({ allergy: 'yes', species: 'cat' }) } }), { animal: null });
        expect(has(html, 'answers-prefers')).toBe(true);
        expect(html.indexOf('data-testid="answers-prefers"')).toBeLessThan(html.indexOf('data-testid="answers-flagged"'));
        expect(text(html)).toContain(`${es.myAnimals.applicants_panel_pref_label}: ${es.myAnimals.applicants_row_summary_species_cat} · ${es.myAnimals.applicants_row_summary_lifestage_puppy}`);
        expect(has(html, 'evaluate-decline')).toBe(true);
        expect(has(html, 'evaluate-propose')).toBe(true);
        expect(has(html, 'evaluate-send-contract')).toBe(false);
        // A general form's links carry no animal.
        expect(html).not.toContain('from=animal:');
    });

    it('an animal application has no «Prefiere» line (it is asked only on general forms)', () => {
        expect(has(render(applicant({ species: 'cat' })), 'answers-prefers')).toBe(false);
    });

    it('origin adopted_animal: «Pidió a Luna (ya adoptada)» under the name', () => {
        const html = render(applicant({ origin: 'adopted_animal', askedAnimal: { id: 'luna', name: 'Luna', sex: 'hembra' } }), { animal: null });
        expect(text(html)).toContain('Pidió a Luna (ya adoptada)');
        expect(html.indexOf('applicant-panel-title')).toBeLessThan(html.indexOf('Pidió a Luna'));
        const male = render(applicant({ origin: 'adopted_animal', askedAnimal: { id: 'toby', name: 'Toby', sex: 'macho' } }), { animal: null });
        expect(text(male)).toContain('Pidió a Toby (ya adoptado)');
    });

    it('declined / closed / proposed / replaced / also_applied: the outcome line replaces the buttons', () => {
        const cases: Array<[Partial<ApplicantSummary>, typeof LUNA | null, string]> = [
            [{ status: { kind: 'declined', at: DECLINED_AT } }, LUNA, 'No avanzó · 10 nov'],
            [{ status: { kind: 'closed', reason: 'adopted_other' } }, LUNA, 'Cerrada: Luna fue adoptada por otra persona'],
            [{ status: { kind: 'closed', reason: 'adopted_open_link' } }, { id: 'toby', name: 'Toby', sex: 'macho' }, 'Cerrada: Toby fue adoptado'],
            [{ status: { kind: 'adopted' }, isSigned: true }, LUNA, 'Adoptó a Luna'],
            [{ status: { kind: 'proposed' }, outcomeAnimal: { id: 'mora', name: 'Mora', sex: 'hembra' } }, null, 'Propuesta para Mora'],
            [{ status: { kind: 'replaced' } }, LUNA, 'Reemplazada por un formulario más nuevo'],
            [{ status: { kind: 'also_applied' }, outcomeAnimal: { id: 'mora', name: 'Mora', sex: 'hembra' } }, null, 'También pidió a Mora'],
        ];
        for (const [o, animal, line] of cases) {
            const html = render(applicant(o), { animal });
            expect(has(html, 'applicant-status-line'), line).toBe(true);
            expect(text(html), line).toContain(line);
            expect(html, line).not.toContain('{animal}');
            for (const id of ['evaluate-decline', 'evaluate-send-contract', 'evaluate-propose']) expect(has(html, id), `${line} ${id}`).toBe(false);
        }
    });

    it('to_evaluate with a replaced link: «Su contrato se reemplazó el {date}»', () => {
        const html = render(applicant({ status: { kind: 'to_evaluate', note: { kind: 'replaced', at: REPLACED_AT } } }));
        expect(text(html)).toContain('Su contrato se reemplazó el 8 nov');
        expect(has(html, 'evaluate-decline')).toBe(true);
        expect(text(html)).toContain(es.myAnimals.applicants_send_contract);
    });

    it('a form with no linked profile keeps «Ver formulario» and nothing to decide', () => {
        const html = render(applicant({ adopterId: null, flags: null, adopterContext: null }));
        expect(text(html)).toContain(es.myAnimals.applicants_view_form);
        expect(has(html, 'evaluate-decline')).toBe(false);
    });

    it('opened from a page: the close control reads «← Volver»', () => {
        expect(text(render(applicant(), { returnLabel: true }))).toContain(E.back);
        expect(text(render(applicant()))).not.toContain(E.back);
    });

    it('answers summary in the panel; the fixed intent / household lines are gone', () => {
        const html = render(applicant({
            // The column-backed `intent` / `household` no longer get fixed lines; only the form's answers speak.
            intent: 'gift', submission: { ...applicant().submission, household: ['2 adultos'], answersJson: JSON.stringify({ willingToSterilize: 'no' }) },
        }));
        expect(has(html, 'answers-flagged')).toBe(true);
        expect(text(html)).not.toContain(`${es.myAnimals.applicants_panel_intent_label}:`);
        expect(text(html)).not.toContain(`${es.myAnimals.applicants_panel_household_label}:`);
        expect(text(html)).not.toContain('2 adultos');
        // «Todas las respuestas» stays (tests/answer-layout opens it).
        expect(text(html)).toContain(es.myAnimals.applicants_panel_all_answers);
    });

    it('after an outcome: the next to evaluate (the one that slid into the slot), wrapping; -1 when none is left', () => {
        const te = { kind: 'to_evaluate', note: null } as const;
        const dec = { kind: 'declined', at: 1 } as const;
        // Was at 1 of [a, b, c]; b declined → [a, c, b'].
        expect(indexAfterOutcome([te, te, dec], 1)).toBe(1);
        // Was the last to evaluate → wraps to the first.
        expect(indexAfterOutcome([te, te, dec], 2)).toBe(0);
        expect(indexAfterOutcome([te, dec], 0)).toBe(0);
        expect(indexAfterOutcome([dec, dec], 0)).toBe(-1);
        expect(indexAfterOutcome([], 0)).toBe(-1);
    });
});
