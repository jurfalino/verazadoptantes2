/**
 * The evaluation inside the applicant panel (spec 2026-11-10 «The applicant
 * panel», «No avanzar», «Proponer un animal»): the answers that need a look,
 * the possible duplicate as the same side-by-side compare every «¿Es la misma
 * persona?» screen uses, the «No avanzar» dialog and the animal picker.
 */
import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { es } from '@/i18n/locales/es';
import type { FormMatchCardData } from '@/lib/formMatchCards';

const tFor = (dict: Record<string, unknown>) => (path: string): string => {
    let cur: unknown = dict;
    for (const k of path.split('.')) cur = (cur as Record<string, unknown> | undefined)?.[k];
    return typeof cur === 'string' ? cur : path;
};
const t = tFor(es as unknown as Record<string, unknown>);

vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ t, locale: 'es' }) }));
vi.mock('@/context/TimezoneContext', () => ({ useDateFormat: () => ({ formatShortDate: () => '' }) }));
vi.mock('@/components/ui/Toast', () => ({ useShowToast: () => ({ error: vi.fn(), success: vi.fn() }) }));
vi.mock('@/lib/clientErrorReporter', () => ({ resolveErrorId: vi.fn(() => 'err12345'), reportClientError: vi.fn() }));
vi.mock('@/app/actions/applications', () => ({ declineApplication: vi.fn(), proposeAnimal: vi.fn(), getProposalAnimals: vi.fn(), getApplicationDuplicates: vi.fn(), getAdoptionOffer: vi.fn(), markOfferDone: vi.fn() }));
vi.mock('@/app/actions/formSubmission', () => ({ linkFormToExistingAdopter: vi.fn() }));
vi.mock('@/app/actions/duplicates', () => ({ dismissDuplicateCandidate: vi.fn() }));
vi.mock('@/app/actions', () => ({ getMatchContext: vi.fn(async () => ({ ok: false })) }));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { isAdmin: false } } }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
// The dialog shell portals after mount (nothing on the server): render its content in place.
vi.mock('@/components/ui/Modal', async (orig) => ({
    ...(await orig<typeof import('@/components/ui/Modal')>()),
    Modal: ({ title, testId, children }: { title: ReactNode; testId?: string; children: ReactNode }) => (
        <div role="dialog" data-testid={testId}><h3>{title}</h3>{children}</div>
    ),
}));

const { ApplicationAnswersSummary } = await import('./ApplicationAnswersSummary');
const { DeclineApplicationDialog, DeclineForm, declineMissing, declineOutcome } = await import('./DeclineApplicationDialog');
const { DuplicateCards } = await import('./ApplicationDuplicate');
const { ProposalAnimalList } = await import('./ProposeAnimalSheet');
const { OfferSheetBody, offerLinks, offerMessage, offerAnimalOf } = await import('./AdoptionOfferSheet');
const { default: FormAnswersPanel } = await import('@/components/FormAnswersPanel');
const { summarizeAnswers } = await import('@/domain/formAnswers');

// <wbr> is a break opportunity inside a word, not a space.
const text = (html: string) => html.replace(/<wbr\s*\/?>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const has = (html: string, id: string) => html.includes(`data-testid="${id}"`);
const count = (html: string, needle: string) => html.split(needle).length - 1;
const F = es.petshield.fields;
const O = es.petshield.options;
const E = es.evaluation;

// allergy yes → amber (household), willingToSterilize no → red (commitments); the rest have no dot or a green one.
const ANSWERS = { allergy: 'yes', willingToSterilize: 'no', housingType: 'house', intent: 'self', species: 'cat', vetCommitment: true, legal: true };

describe('ApplicationAnswersSummary', () => {
    it('answers: red then amber as «{question}: {answer}», then «N respuestas sin observaciones · Ver todas»; none → «Ninguna respuesta para revisar»', () => {
        const html = renderToStaticMarkup(<ApplicationAnswersSummary answers={ANSWERS} onSeeAll={() => {}} />);
        const flagged = text(html);
        const red = `${F.willingToSterilize}: ${O.willingToSterilize.no}`;
        const amber = `${F.allergy}: ${O.allergy.yes}`;
        expect(flagged).toContain(red);
        expect(flagged).toContain(amber);
        expect(flagged.indexOf(red)).toBeLessThan(flagged.indexOf(amber));
        expect(html).toContain('data-signal="risk"');
        expect(html).toContain('data-signal="caution"');
        expect(has(html, 'answers-rest')).toBe(true);
        expect(flagged).toContain(`${E.answers_rest_many.replace('{n}', '5')} · ${E.answers_see_all}`);
        expect(has(html, 'answers-none')).toBe(false);

        const calm = renderToStaticMarkup(<ApplicationAnswersSummary answers={{ intent: 'self', housingType: 'house' }} onSeeAll={() => {}} />);
        expect(has(calm, 'answers-none')).toBe(true);
        expect(text(calm)).toContain(E.answers_none);
        expect(has(calm, 'answers-flagged')).toBe(false);
        expect(text(calm)).toContain(E.answers_rest_many.replace('{n}', '2'));

        const one = renderToStaticMarkup(<ApplicationAnswersSummary answers={{ intent: 'self' }} onSeeAll={() => {}} />);
        expect(text(one)).toContain(E.answers_rest_one);
    });

    it('the household people list counts as one answer, red when someone is under 5', () => {
        const answers = { children: '2', householdPeople: [{ relationship: 'partner', age: 34 }, { relationship: 'child', age: 3 }] };
        const html = renderToStaticMarkup(<ApplicationAnswersSummary answers={answers} onSeeAll={() => {}} />);
        expect(has(html, 'answers-flagged')).toBe(true);
        expect(text(html)).toContain(`${F.household}:`);
        expect(has(html, 'answers-rest')).toBe(false);
    });

    it('the rest count equals the rows in «Todas las respuestas» for the same form', () => {
        for (const answers of [ANSWERS, { intent: 'gift', isSafe: 'no', species: 'dog', lifeStage: 'senior', existingPets: { dog: 1, cat: 0 }, motivation: { open: 'Quiero' } }]) {
            const panel = renderToStaticMarkup(<FormAnswersPanel fullAnswers={answers} />);
            const rows = count(panel, 'data-testid="answer-row"') + count(panel, 'data-testid="household-people"');
            const { flagged, restCount } = summarizeAnswers(answers);
            expect(flagged.length + restCount).toBe(rows);
            const summary = renderToStaticMarkup(<ApplicationAnswersSummary answers={answers} onSeeAll={() => {}} />);
            // The summary's own rows never read as rows of «Todas las respuestas».
            expect(count(summary, 'data-testid="answer-row"')).toBe(0);
            expect(count(summary, 'data-testid="answer-flagged-row"')).toBe(flagged.length);
        }
    });
});

describe('«No avanzar»', () => {
    it('decline dialog: prefilled «No avanzamos con su solicitud para Luna.», «Guardar» disabled with «Falta: calificación y motivo»', () => {
        const html = renderToStaticMarkup(
            <DeclineApplicationDialog applicationId="app-1" personName="Juan Pérez" animalName="Luna" onClose={() => {}} onDone={() => {}} />,
        );
        expect(has(html, 'decline-dialog')).toBe(true);
        expect(text(html)).toContain('No avanzar con Juan para Luna');
        expect(text(html)).toContain('Se guarda como una observación en el perfil de Juan, como cualquier otra.');
        expect(html).toMatch(/data-testid="decline-text"[^>]*>No avanzamos con su solicitud para Luna\.<\/textarea>/);
        expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-testid="decline-save"|<button[^>]*data-testid="decline-save"[^>]*disabled=""/);
        expect(text(html)).toContain(E.missing_both);
        expect(has(html, 'decline-missing')).toBe(true);
        // The app's real star rating, large, not clearable (no «Quitar»).
        expect(count(html, 'aria-label="1 star"')).toBe(1);
        expect(html).toContain('w-8 h-8');
    });

    it('general application: «No avanzar con Juan» and «No avanzamos con su solicitud.»', () => {
        const html = renderToStaticMarkup(
            <DeclineApplicationDialog applicationId="app-1" personName="Juan Pérez" animalName={null} onClose={() => {}} onDone={() => {}} />,
        );
        expect(text(html)).toContain('No avanzar con Juan');
        expect(text(html)).not.toContain('No avanzar con Juan para');
        expect(html).toMatch(/data-testid="decline-text"[^>]*>No avanzamos con su solicitud\.<\/textarea>/);
    });

    it('what is missing, until both are filled', () => {
        expect(declineMissing(0, '')).toBe('missing_both');
        expect(declineMissing(0, 'motivo')).toBe('missing_rating');
        expect(declineMissing(3, '   ')).toBe('missing_reason');
        expect(declineMissing(3, 'No tiene patio')).toBeNull();
    });

    it('decline dialog at 1★ shows import.rating_one_bans', () => {
        const form = (rating: number, reason: string) => renderToStaticMarkup(
            <DeclineForm text="No avanzamos." rating={rating} reason={reason} busy={false} onText={() => {}} onRating={() => {}} onReason={() => {}} />,
        );
        expect(text(form(1, ''))).toContain(es.import.rating_one_bans);
        expect(text(form(1, ''))).toContain(E.missing_reason);
        // Not clearable: no «Quitar» once rated.
        expect(text(form(1, ''))).not.toContain(es.ratings.clear);
        expect(text(form(2, ''))).not.toContain(es.import.rating_one_bans);
        const ready = form(3, 'No tiene patio');
        expect(has(ready, 'decline-missing')).toBe(false);
        expect(has(ready, 'decline-reason')).toBe(true);
    });
});

const card = (o: Partial<FormMatchCardData['profile']> = {}, m: Partial<FormMatchCardData['match']> = {}): FormMatchCardData => ({
    match: { id: 'carla', name: 'Carla Pérez', matchTypes: ['phone'], candidateId: 'dc-1', canAnswer: true, ...m },
    profile: { id: 'carla', name: 'Carla Pérez', contactInfo: '11 5555-0109', addressInfo: null, status: '4', addedByName: 'Sofía Rescate', isMine: false, ...o },
});
const dup = (cards: FormMatchCardData[]) => renderToStaticMarkup(
    <DuplicateCards
        result={{ applicant: { name: 'Ana Pérez', phone: '11 5555-0109' }, cards, canLink: true, willMerge: true }}
        submissionId="s-1" applicantSelfieUrl={null} onDismiss={() => {}} onLinked={() => {}}
    />,
);

describe('the possible duplicate inside the evaluation', () => {
    it('the same side-by-side compare as every «¿Es la misma persona?» screen, with both answers', () => {
        const html = dup([card()]);
        expect(has(html, 'applicant-duplicate')).toBe(true);
        expect(text(html)).toContain(es.samePerson.question);
        expect(text(html)).toContain('Carla Pérez');
        expect(text(html)).toContain(es.samePerson.yes);
        expect(text(html)).toContain(es.samePerson.no);
        expect(has(html, 'form-match-not-this')).toBe(true);
        expect(html).toContain('id="comparison-carla"');
    });

    it('«Cargado por {name}» for another rescuer\'s profile; «Tuyo» for the viewer\'s own; the anonymous line when nobody loaded it', () => {
        expect(text(dup([card()]))).toContain('Cargado por Sofía Rescate');
        const mine = text(dup([card({ isMine: true, addedByName: 'Juan Rescatista' })]));
        expect(mine).toContain(es.myAdopters.pending_d_mine_tag);
        expect(mine).not.toContain('Cargado por');
        expect(text(dup([card({ addedByName: null })]))).toContain(es.myAdopters.pending_dedup_created_by_anonymous);
    });

    it('no cards: nothing at all', () => {
        expect(dup([])).toBe('');
    });
});

describe('«Proponer un animal»', () => {
    const animal = (id: string, candidates: number, o: Record<string, unknown> = {}) => ({ id, name: id === 'mora' ? 'Mora' : 'Toby', species: 'cat', photo: null, matches: true, candidates, ...o });

    it('one ≥44px row per animal with its photo or species icon, name and «N candidatos»', () => {
        const html = renderToStaticMarkup(<ProposalAnimalList animals={[animal('mora', 1, { photo: 'https://img/mora.jpg' }), animal('toby', 3, { species: 'dog' }), animal('nube', 0, { name: null })]} busyId={null} onPick={() => {}} />);
        for (const id of ['mora', 'toby', 'nube']) expect(has(html, `propose-animal-${id}`)).toBe(true);
        expect(text(html)).toContain(`Mora ${E.candidates_one}`);
        expect(text(html)).toContain(`Toby ${E.candidates_many.replace('{n}', '3')}`);
        expect(text(html)).toContain(E.candidates_none);
        expect(text(html)).toContain(es.homeModules.unnamed_animal);
        expect(count(html, 'min-h-11')).toBeGreaterThanOrEqual(3);
        expect(html).toContain('mora.jpg');
    });

    it('no animal can take applications: «No hay animales que puedan recibir solicitudes.»', () => {
        expect(text(renderToStaticMarkup(<ProposalAnimalList animals={[]} busyId={null} onPick={() => {}} />))).toContain(E.propose_empty);
    });
});

describe('the offer to tell the others (decision 4)', () => {
    const ana = { applicationId: 'app-1', firstName: 'Ana', phone: '+54 9 11 5555-0101', email: 'ana@example.com' };
    const beto = { applicationId: 'app-2', firstName: 'Beto', phone: null, email: 'beto+x@example.com' };
    const caro = { applicationId: 'app-3', firstName: 'Caro', phone: '11 5555 0103', email: null };

    it('AdoptionOfferSheet: Jon\'s message with {name}/{animal} filled; WhatsApp only with a phone (wa.me/<digits>?text=), Email only with an email (mailto:…?subject=&body=)', () => {
        // The textarea holds Jon's text with the animal filled once; {name} stays for each person.
        const message = offerMessage(t, 'Luna');
        expect(message).toBe(E.offer_message.replace('{animal}', 'Luna'));
        expect(message).toContain('{name}');

        const forAna = E.offer_message.replace('{name}', 'Ana').replace('{animal}', 'Luna');
        expect(offerLinks(ana, message, 'Luna')).toEqual({
            whatsapp: `https://wa.me/5491155550101?text=${encodeURIComponent(forAna)}`,
            email: `mailto:ana@example.com?subject=${encodeURIComponent('Luna')}&body=${encodeURIComponent(forAna)}`,
        });
        expect(offerLinks(beto, message, 'Luna').whatsapp).toBeNull();
        expect(offerLinks(beto, message, 'Luna').email).toMatch(/^mailto:beto%2Bx@example\.com\?subject=Luna&body=Hola%20Beto%2C/);
        expect(offerLinks(caro, message, 'Luna').email).toBeNull();
        // An edited message is the one sent.
        expect(offerLinks(ana, 'Hola {name}! Luna ya tiene casa.', 'Luna').whatsapp).toBe(`https://wa.me/5491155550101?text=${encodeURIComponent('Hola Ana! Luna ya tiene casa.')}`);

        const html = renderToStaticMarkup(
            <OfferSheetBody animalName="Luna" message={message} onMessage={() => {}} candidates={[ana, beto, caro]} busy={false} onNotNow={() => {}} onDone={() => {}} />,
        );
        expect(html).toContain('data-testid="offer-message"');
        expect(text(html)).toContain(E.offer_message_label);
        // One row per person, with only the buttons their contacts allow.
        expect(has(html, 'offer-wa-app-1')).toBe(true);
        expect(has(html, 'offer-email-app-1')).toBe(true);
        expect(has(html, 'offer-wa-app-2')).toBe(false);
        expect(has(html, 'offer-email-app-2')).toBe(true);
        expect(has(html, 'offer-wa-app-3')).toBe(true);
        expect(has(html, 'offer-email-app-3')).toBe(false);
        expect(html).toContain(`href="https://wa.me/5491155550101?text=${encodeURIComponent(forAna)}"`);
        for (const n of ['Ana', 'Beto', 'Caro']) expect(text(html)).toContain(n);
        // «Ahora no» and «Listo».
        expect(has(html, 'offer-not-now')).toBe(true);
        expect(has(html, 'offer-done')).toBe(true);
        expect(text(html)).toContain(E.offer_not_now);
        expect(text(html)).toContain(E.offer_done);
        // Every button is a ≥44px tap target, never an emoji.
        expect(html).not.toMatch(/💬|📧/);
        const links = html.match(/<a[^>]*data-testid="offer-(wa|email)-[^"]*"[^>]*>/g) ?? [];
        expect(links).toHaveLength(4);
        for (const a of links) expect(a).toMatch(/min-h-(11|\[44px\])/);
    });
});

describe('after a save: the offer sheet only when the save closed other candidates', () => {
    it('closedApplications with a count → that animal; none, zero or no result → the form closes as before', () => {
        expect(offerAnimalOf({ closedApplications: { animalId: 'luna', count: 2 } })).toBe('luna');
        expect(offerAnimalOf({ closedApplications: { animalId: 'luna', count: 0 } })).toBeNull();
        expect(offerAnimalOf({})).toBeNull();
        expect(offerAnimalOf(null)).toBeNull();
        expect(offerAnimalOf(undefined)).toBeNull();
    });
});

describe('«No avanzar» — what the answer leads to (final review M8)', () => {
    it('done / already decided elsewhere (an info notice: the observation was NOT saved) / failed', () => {
        expect(declineOutcome({ ok: true, recordId: 'r' })).toEqual({ kind: 'done' });
        expect(declineOutcome({ ok: false, error: 'already_decided' })).toEqual({ kind: 'already_decided', messageKey: 'evaluation.decline_already_decided' });
        expect(declineOutcome({ ok: false, error: 'failed', errorId: 'abcd1234' })).toEqual({ kind: 'failed', errorId: 'abcd1234' });
        expect(declineOutcome({ ok: false, error: 'not_allowed' })).toEqual({ kind: 'failed', errorId: null });
        expect(t('evaluation.decline_already_decided')).toBe('Esta solicitud ya tenía un resultado. No se guardó tu observación.');
    });
});
