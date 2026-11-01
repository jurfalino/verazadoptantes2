/**
 * «Ya está en otro perfil», option B (Jon 2026-10-29): a compact inline box
 * that never repeats the typed contact, and a window with the match card whose
 * answers are the server's (`match.action`: continue / flag / review_admins /
 * pending) — only on a saved profile — «No es esta persona» hiding the row for
 * the same typed value, and «Continuar»'s confirmation (the shared dialog in
 * its absorb mode, UX C1) with the rating after the merge and who is told.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { es } from '@/i18n/locales/es';

const tFor = (dict: Record<string, unknown>) => (path: string): string => {
    let cur: unknown = dict;
    for (const k of path.split('.')) cur = (cur as Record<string, unknown> | undefined)?.[k];
    return typeof cur === 'string' ? cur : '';
};
const t = tFor(es as unknown as Record<string, unknown>);

vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ t, locale: 'es' }) }));
vi.mock('@/app/actions', () => ({
    getDuplicateHintMatches: vi.fn(), grantSearchMatchAccess: vi.fn(), flagAdopterAsDuplicate: vi.fn(), countAdoptersBySocialHandle: vi.fn(),
    continueWithMatchedProfile: vi.fn(), askAdminsToReviewPair: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/lib/clientErrorReporter', () => ({ resolveErrorId: vi.fn(() => 'e1'), reportClientError: vi.fn() }));
vi.mock('@/components/ui/Toast', () => ({ useShowToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
// The dialog shell portals to document.body: rendered in place here.
vi.mock('@/components/ui/Modal', () => ({
    Modal: ({ title, testId, children }: { title: string; testId?: string; children: React.ReactNode }) => <div data-testid={testId}><h3>{title}</h3>{children}</div>,
    ModalText: ({ children, testId }: { children: React.ReactNode; testId?: string }) => <p data-testid={testId}>{children}</p>,
    ModalActions: ({ confirm }: { confirm: { label: string; testId?: string } }) => <div><button data-testid="cancel">Cancelar</button><button data-testid={confirm.testId}>{confirm.label}</button></div>,
}));

import { DupHintBox, DupHintContinueDialog, DupHintFailed, DupHintProfile } from './DuplicateHint';
import { ContinueMergeDialog } from './ContinueMergeDialog';
import { dismissDupHintMatch, NO_DISMISSED, visibleDupHintMatches } from '@/domain/dupHint';
import type { DupHintMatch } from '@/app/actions/households';
import { NO_PERIOD_ALERTS } from '@/domain/periodAlerts';

const TYPED = '6585-1333';
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

function match(id: string, name: string, over: Partial<DupHintMatch> = {}): DupHintMatch {
    return {
        adopterId: id, adopterName: name, relevancePercent: 50, matchTypes: ['phone_suffix'], matchValues: [], source: 'token',
        adopter: { id, name, contactEntries: JSON.stringify([
            { id: `${id}-p`, type: 'phone', value: '•••• 1333', masked: true },
            { id: `${id}-e`, type: 'email', value: 'j•••@gmail.com', masked: true },
        ]) } as DupHintMatch['adopter'],
        matchSnippet: null, contactProtected: true, visibilityBadge: null, avgRating: null, thumbnail: null,
        stats: { searchHits: 0, profileViews: 0, requests: 0, adoptions: 0 },
        flags: { inaccurate: false, duplicate: false, systemDuplicate: false, verified_identity: false, verified_address: false, tooManyAdoptions: null, tooManyRequests: null } as DupHintMatch['flags'],
        householdLine: [], openAlerts: [], activity: {}, rating: null, matchedEntryIndexes: [0], action: 'continue', alreadyPending: false,
        ...over,
    };
}

const jonathan = match('a', 'Jonathan Urfalino');
const jonatan = match('b', 'Jonatan Urfalino', {
    rating: 4,
    householdLine: [
        { name: 'Pedro Paez', profileId: 'p', rating: 1, openAlerts: [], alerts: NO_PERIOD_ALERTS, isMinor: false, isGift: false, householdId: 'h1' },
        { name: 'Delia Urfalino', profileId: 'd', rating: null, openAlerts: [], alerts: NO_PERIOD_ALERTS, isMinor: false, isGift: false, householdId: 'h1' },
    ],
});

describe('DupHintBox — the compact inline notice', () => {
    it('header by count, one row per match: name, rating, «Ver perfil»; no household line (Jon 2026-10-31)', () => {
        const html = renderToStaticMarkup(<DupHintBox matches={[jonathan, jonatan]} done={new Map()} onView={() => {}} />);
        expect(text(html)).toContain('Ya está en 2 perfiles');
        expect(html.match(/data-testid="dup-hint-row"/g)).toHaveLength(2);
        expect(html.match(/data-testid="dup-hint-view"/g)).toHaveLength(2);
        expect(text(html)).toContain('Sin calificación');
        // No household line, even on Jonatan's row whose housemate is 1★.
        // No housemate chip either, even on Jonatan's row whose housemate is 1★ (duplicate cards show no home).
        expect(html).not.toContain('data-alert="housemate_low_rating"');
        expect(html).not.toContain('data-alert="housemate_alerts"');
        expect(text(html)).not.toContain('Conviviente');
        // Warning tone through theme tokens, not raw amber classes.
        expect(html).toContain('var(--status-warning-bg)');
        expect(html).not.toMatch(/amber-/);
    });

    it('never repeats the contact just typed', () => {
        const html = renderToStaticMarkup(<DupHintBox matches={[jonathan]} done={new Map()} onView={() => {}} />);
        expect(text(html)).toContain('Ya está en otro perfil');
        expect(html).not.toContain('1333');
        expect(html).not.toContain('data-testid="dup-hint-contact"');
    });

    it('«No es esta persona» drops that row for the same typed value', () => {
        const dismissed = dismissDupHintMatch(NO_DISMISSED, TYPED, 'b');
        const html = renderToStaticMarkup(<DupHintBox matches={visibleDupHintMatches([jonathan, jonatan], dismissed, TYPED)} done={new Map()} onView={() => {}} />);
        expect(html.match(/data-testid="dup-hint-row"/g)).toHaveLength(1);
        expect(html).toContain('data-adopter-id="a"');
        expect(html).not.toContain('data-adopter-id="b"');
        expect(text(html)).toContain('Ya está en otro perfil');
        // Both answered → no box at all.
        const none = visibleDupHintMatches([jonathan, jonatan], dismissDupHintMatch(dismissed, TYPED, 'a'), TYPED);
        expect(renderToStaticMarkup(<DupHintBox matches={none} done={new Map()} onView={() => {}} />)).toBe('');
    });

    it('an answered row shows «Marcado» / «Enviado a los administradores» instead of «Ver perfil»', () => {
        const html = renderToStaticMarkup(<DupHintBox matches={[jonathan, jonatan]} done={new Map([['a', 'flagged']])} onView={() => {}} />);
        expect(html.match(/data-testid="dup-hint-flagged"/g)).toHaveLength(1);
        expect(html.match(/data-testid="dup-hint-view"/g)).toHaveLength(1);
        const sent = renderToStaticMarkup(<DupHintBox matches={[jonathan, jonatan]} done={new Map([['b', 'sent']])} onView={() => {}} />);
        expect(sent).toContain('data-testid="dup-hint-sent"');
        expect(text(sent)).toContain('Enviado a los administradores');
    });
});

describe('DupHintProfile — the window', () => {
    const noop = () => {};
    const handlers = { onContinue: noop, onFlag: noop, onReview: noop, onNotThis: noop, onOpenFull: noop };
    const ids = (html: string) => [...html.matchAll(/data-testid="(dup-hint-[a-z-]+)"/g)].map(m => m[1])
        .filter(id => ['dup-hint-continue', 'dup-hint-flag', 'dup-hint-review', 'dup-hint-open-to-add', 'dup-hint-not-this', 'dup-hint-open-full'].includes(id));

    it('the match card: header without the household line, contacts with the typed one «coincide», activity', () => {
        const html = renderToStaticMarkup(<DupHintProfile match={jonatan} canAct {...handlers} />);
        expect(html).toContain('data-testid="dup-hint-window-head"');
        // The window shows no home: no housemate chip for Jonatan's 1★ housemate (Jon 2026-10-31).
        expect(html).not.toContain('data-alert="housemate_low_rating"');
        expect(text(html)).not.toContain('Conviviente');
        expect(html.match(/data-testid="dup-hint-contact"/g)).toHaveLength(2);
        expect(html.match(/data-testid="contact-matches"/g)).toHaveLength(1);
        expect(html).toContain('data-testid="dup-hint-activity"');
    });

    it("case 1 'continue': «Unir con este perfil», «No es esta persona», then «Abrir perfil ↗» — in that order (point B)", () => {
        const html = renderToStaticMarkup(<DupHintProfile match={jonatan} canAct {...handlers} />);
        expect(ids(html)).toEqual(['dup-hint-continue', 'dup-hint-not-this', 'dup-hint-open-full']);
        expect(text(html)).toContain('Unir con este perfil');
        expect(text(html)).not.toContain('Continuar con este perfil');
        expect(text(html)).toContain('Abrir perfil');
        expect(text(html)).not.toContain('Abrir perfil completo');
        expect(html).not.toContain('data-testid="dup-hint-pending-note"');
        // An admin on a pair already up for review: said, and «Continuar» stays.
        const admin = renderToStaticMarkup(<DupHintProfile match={{ ...jonatan, alreadyPending: true }} canAct {...handlers} />);
        expect(text(admin)).toContain('Ya está marcado para revisar.');
        expect(ids(admin)[0]).toBe('dup-hint-continue');
    });

    it("case 2 'flag': who loaded it, «Marcar como posible duplicado» + who is told, «No es esta persona», then the same «Abrir perfil ↗» link the owner sees", () => {
        const html = renderToStaticMarkup(<DupHintProfile match={{ ...jonatan, action: 'flag', cantJoin: 'other_owner', cantJoinName: 'Lucía Fernández' }} canAct {...handlers} />);
        expect(ids(html)).toEqual(['dup-hint-flag', 'dup-hint-not-this', 'dup-hint-open-to-add']);
        const said = text(html);
        // It names the profile being edited (UX I5): under Jonatan's card it read as being about Jonatan.
        expect(said).toContain('El perfil de Lucía Fernández lo cargó otra persona, así que no podés unir los dos vos. Podés:');
        expect(said).toContain('Marcar como posible duplicado');
        expect(said).toContain('Les avisamos a quienes cargaron cada perfil y a los administradores.');
        expect(said).toContain('Abrir perfil');
        expect(said).not.toContain('Abrir perfil para agregar datos');
        expect(said.indexOf('lo cargó otra persona')).toBeLessThan(said.indexOf('Marcar como posible duplicado'));
        expect(html).not.toContain('data-testid="dup-hint-continue"');
        // Case 3 (the match has no owner, the profile being edited is mine): no «Lo cargó otra persona».
        const ownerless = renderToStaticMarkup(<DupHintProfile match={{ ...jonatan, action: 'flag' }} canAct {...handlers} />);
        expect(ownerless).not.toContain('data-testid="dup-hint-cant-join"');
        expect(ids(ownerless)[0]).toBe('dup-hint-flag');
    });

    it('case 2 when nobody is responsible for the profile being edited: «El perfil de {name} no tiene un responsable…» (fix round 2, N7; UX I5)', () => {
        const html = renderToStaticMarkup(<DupHintProfile match={{ ...jonatan, action: 'flag', cantJoin: 'no_owner', cantJoinName: 'Lucía Fernández' }} canAct {...handlers} />);
        expect(text(html)).toContain('El perfil de Lucía Fernández no tiene un responsable, así que no podés unir los dos vos. Podés:');
        expect(text(html)).not.toContain('lo cargó otra persona');
        expect(ids(html)[0]).toBe('dup-hint-flag');
        // A nameless profile still reads as a sentence.
        const nameless = renderToStaticMarkup(<DupHintProfile match={{ ...jonatan, action: 'flag', cantJoin: 'no_owner', cantJoinName: '' }} canAct {...handlers} />);
        expect(text(nameless)).toContain(`El perfil de ${es.adopter.nameless} no tiene un responsable`);
    });

    it('a said-no pair this viewer can\'t ask about: «Ya dijeron que no…», no flag (the server refuses one)', () => {
        const html = renderToStaticMarkup(<DupHintProfile match={{ ...jonatan, action: 'flag', cantJoin: 'other_owner', saidNo: true }} canAct {...handlers} />);
        expect(text(html)).toContain('Ya dijeron que no son la misma persona.');
        expect(ids(html)).toEqual(['dup-hint-not-this', 'dup-hint-open-to-add']);
    });

    it("case 4 'review_admins': «Ya dijeron que no…» and «Pedir revisión a un administrador» — never «Continuar»", () => {
        const html = renderToStaticMarkup(<DupHintProfile match={{ ...jonatan, action: 'review_admins' }} canAct {...handlers} />);
        expect(text(html)).toContain('Ya dijeron que no son la misma persona.');
        expect(text(html)).toContain(es.myAdopters.pending_d_action_dispute);
        expect(ids(html)).toEqual(['dup-hint-review', 'dup-hint-not-this', 'dup-hint-open-full']);
    });

    it("'settled' (already recorded as two people): «Ya figuran como personas distintas.», only «No es esta persona» and the open link (F3)", () => {
        const html = renderToStaticMarkup(<DupHintProfile match={{ ...jonatan, action: 'settled' }} canAct {...handlers} />);
        expect(text(html)).toContain('Ya figuran como personas distintas.');
        expect(ids(html)).toEqual(['dup-hint-not-this', 'dup-hint-open-full']);
    });

    it("case 5 'pending': only said — «No es esta persona» and the open link, no flag, no continue", () => {
        const html = renderToStaticMarkup(<DupHintProfile match={{ ...jonatan, action: 'pending', alreadyPending: true }} canAct {...handlers} />);
        expect(text(html)).toContain('Ya está marcado para revisar.');
        expect(ids(html)).toEqual(['dup-hint-not-this', 'dup-hint-open-full']);
    });

    it('a handle with no network picked: «Continuar» waits, asking «¿Qué red social es?» as the composer does (fix round 1)', () => {
        const html = renderToStaticMarkup(<DupHintProfile match={jonatan} canAct needsPlatform {...handlers} />);
        expect(html).toContain('data-testid="dup-hint-needs-platform"');
        expect(text(html)).toContain('¿Qué red social es? *');
        expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-testid="dup-hint-continue"|<button[^>]*data-testid="dup-hint-continue"[^>]*disabled=""/);
        const ready = renderToStaticMarkup(<DupHintProfile match={jonatan} canAct {...handlers} />);
        expect(ready).not.toContain('data-testid="dup-hint-needs-platform"');
    });

    it('…with the composer\'s network chips in the window (UX I6): picking one enables «Continuar», the chips stay showing the pick', () => {
        const continueOff = /<button[^>]*disabled=""[^>]*data-testid="dup-hint-continue"|<button[^>]*data-testid="dup-hint-continue"[^>]*disabled=""/;
        const asking = renderToStaticMarkup(<DupHintProfile match={jonatan} canAct needsPlatform platform={null} onPickPlatform={() => {}} {...handlers} />);
        expect(asking).toContain('aria-label="Instagram"');
        expect(asking).not.toContain('aria-pressed="true"');
        expect(asking).toMatch(continueOff);
        // Picked in the window: no longer required, the pick shown, «Continuar» on.
        const picked = renderToStaticMarkup(<DupHintProfile match={jonatan} canAct platform="instagram" platformAsk onPickPlatform={() => {}} {...handlers} />);
        expect(picked).toContain('data-testid="dup-hint-needs-platform"');
        expect(picked).toMatch(/aria-pressed="true"[^>]*aria-label="Instagram"|aria-label="Instagram"[^>]*aria-pressed="true"/);
        expect(text(picked)).not.toContain('¿Qué red social es? *');
        expect(picked).not.toMatch(continueOff);
        // No way to pick (no setter): the ask alone, as before.
        expect(renderToStaticMarkup(<DupHintProfile match={jonatan} canAct needsPlatform {...handlers} />)).not.toContain('aria-label="Instagram"');
    });

    it('a standalone «sin actividad» starts with a capital (fix round 1)', () => {
        const html = renderToStaticMarkup(<DupHintProfile match={{ ...jonatan, activity: {} }} canAct {...handlers} />);
        expect(html).toMatch(/<div class="first-letter:uppercase"><span[^>]*data-testid="dup-hint-activity"[^>]*>sin actividad<\/span>/);
    });

    it('no answer without a saved profile being edited', () => {
        const html = renderToStaticMarkup(<DupHintProfile match={jonathan} canAct={false} {...handlers} />);
        expect(ids(html)).toEqual(['dup-hint-not-this', 'dup-hint-open-full']);
    });
});

describe('DupHintContinueDialog — «Continuar con este perfil»\'s confirmation, in its absorb mode (UX C1)', () => {
    const preview = { newContacts: [{ id: 'c1', type: 'phone' as const, value: '555-1234' }, { id: 'c2', type: 'email' as const, value: 'maria@example.com' }], records: 1, ratingAfter: 4, currentName: 'María García López' };

    it('says the profile being edited goes away: its title, a first line at body size, «Sí, unirlos»; what it adds, the rating after, who is told', () => {
        const html = renderToStaticMarkup(<DupHintContinueDialog match={{ ...jonatan, preview, toldNames: ['Refugio Patitas'] }} busy={false} failure={null} onCancel={() => {}} onConfirm={() => {}} />);
        const said = text(html);
        expect(said).toContain('¿Unir el perfil de María García López con el de Jonatan Urfalino?');
        expect(html).toMatch(/<p data-testid="continue-merge-absorbed">El perfil de María García López deja de existir: sus datos y registros pasan al de Jonatan Urfalino\.<\/p>/);
        expect(said).not.toContain(es.adopter.merge_confirm_body);
        expect(said).not.toContain('¿Continuar con el perfil');
        expect(said).toContain('555-1234');
        expect(said).toContain('maria@example.com');
        expect(said).toContain('1 registro');
        expect(html).toContain('data-testid="dup-hint-rating-after"');
        expect(said).toContain('Calificación después de unirlos:');
        expect(said).toContain('4.0 · Bueno');
        // Who is told, alone on its line — «deja de existir» is said once, up top.
        expect(html).toMatch(/data-testid="dup-hint-confirm-told">Le avisamos a Refugio Patitas, que puede deshacerlo si no es la misma persona\.<\/p>/);
        expect(said).not.toContain('por separado');
        expect(said).toContain('Sí, unirlos');
        expect(said).not.toContain('Sí, continuar');
    });

    it('nothing new to add: never «Solo abriremos el perfil existente» (the other profile goes away)', () => {
        const html = renderToStaticMarkup(<DupHintContinueDialog match={{ ...jonatan, preview: { ...preview, newContacts: [], records: 0 }, toldNames: [] }} busy={false} failure={null} onCancel={() => {}} onConfirm={() => {}} />);
        expect(html).not.toContain('data-testid="continue-merge-nothing-new"');
        expect(text(html)).not.toContain('Solo abriremos el perfil existente');
        expect(text(html)).toContain('deja de existir');
    });

    it('an admin merging two owners\' profiles: plural; nobody told: no line; unrated after: «Sin calificación»', () => {
        const two = text(renderToStaticMarkup(<DupHintContinueDialog match={{ ...jonatan, preview, toldNames: ['Gatitos Felices', 'Refugio Patitas'] }} busy={false} failure={null} onCancel={() => {}} onConfirm={() => {}} />));
        expect(two).toContain('Les avisamos a Gatitos Felices y Refugio Patitas, que pueden deshacerlo si no es la misma persona.');
        const none = renderToStaticMarkup(<DupHintContinueDialog match={{ ...jonatan, preview: { ...preview, ratingAfter: null }, toldNames: [] }} busy={false} failure={null} onCancel={() => {}} onConfirm={() => {}} />);
        expect(none).not.toContain('data-testid="dup-hint-confirm-told"');
        expect(text(none)).not.toContain('Le avisamos');
        expect(text(none)).toContain('Sin calificación');
    });

    it('a failure is said in the dialog, with its id', () => {
        const html = renderToStaticMarkup(<DupHintContinueDialog match={{ ...jonatan, preview }} busy={false} failure="No se pudo unir los perfiles (error ab12)." onCancel={() => {}} onConfirm={() => {}} />);
        expect(html).toContain('role="alert"');
        expect(text(html)).toContain('No se pudo unir los perfiles (error ab12).');
    });
});

describe('ContinueMergeDialog — the new-profile form\'s path is unchanged (nothing saved yet, nothing lost)', () => {
    it('without `absorb`: «¿Continuar con el perfil de X?», the shared body, «Solo abriremos…» when nothing is new, «Sí, continuar»', () => {
        const html = renderToStaticMarkup(<ContinueMergeDialog name="Jonatan Urfalino" newContacts={[]} onCancel={() => {}} onConfirm={() => {}} />);
        const said = text(html);
        expect(said).toContain('¿Continuar con el perfil de Jonatan Urfalino?');
        expect(said).toContain(es.adopter.merge_confirm_body);
        expect(html).toContain('data-testid="continue-merge-nothing-new"');
        expect(said).toContain('Solo abriremos el perfil existente');
        expect(said).toContain('Sí, continuar');
        expect(html).not.toContain('data-testid="continue-merge-absorbed"');
    });

    it('with `absorb`: never «Solo abriremos…»', () => {
        const html = renderToStaticMarkup(<ContinueMergeDialog absorb={{ currentName: 'Lucía Fernández' }} name="Jonathan Urfalino" newContacts={[]} onCancel={() => {}} onConfirm={() => {}} />);
        expect(html).not.toContain('data-testid="continue-merge-nothing-new"');
        expect(text(html)).toContain('¿Unir el perfil de Lucía Fernández con el de Jonathan Urfalino?');
        expect(text(html)).toContain('Sí, unirlos');
    });
});

describe('DupHintFailed — a failed check is said, never shown as «no matches»', () => {
    it('one line with the error id', () => {
        const html = renderToStaticMarkup(<DupHintFailed errorId="ab12cd34" />);
        expect(html).toContain('data-testid="dup-hint-failed"');
        expect(html).toContain('role="status"');
        expect(text(html)).toBe('No pudimos revisar si este dato ya está en otro perfil (error ab12cd34).');
    });
});
