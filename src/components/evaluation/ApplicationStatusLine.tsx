'use client';

/**
 * Where an application stands, in one line under the applicant's name
 * (spec 2026-11-10 «Outcome line»): «Contrato enviado el 9 nov», «No avanzó ·
 * 10 nov», «Cerrada: Luna fue adoptada por otra persona», «Propuesta para
 * Luna»… An application still to evaluate shows nothing — unless its contract
 * link was replaced or ran out («Su contrato se reemplazó el {date}»).
 */
import { useLanguage } from '@/context/LanguageContext';
import { useDateFormat } from '@/context/TimezoneContext';
import { isFemaleAnimal } from '@/domain/animalSex';
import { APPLICATION_CLOSE_REASONS } from '@/domain/constants';
import type { ApplicationStatus } from '@/domain/applications';

export type NamedAnimal = { name: string; sex: string | null; /** A proposal's animal adopted since: «(ya adoptado)». */ adopted?: boolean };

/** `{animal}` filled, with the sex-agreeing variant of `<key>_f` / `<key>_m`. */
export function animalLine(t: (k: string) => string, key: string, animal: NamedAnimal): string {
    return t(`${key}_${isFemaleAnimal(animal.sex) ? 'f' : 'm'}`).replace('{animal}', animal.name);
}

/** The line's text; null only for an application still to evaluate with no contract note. Every outcome has a line. */
export function statusLineText(
    status: ApplicationStatus,
    ctx: { animal: NamedAnimal | null; outcomeAnimal: NamedAnimal | null },
    t: (k: string) => string,
    formatDate: (unixSec: number) => string,
): string | null {
    // An animal of this viewer's team with no name reads «Sin nombre» (`name: ''`); an animal HIDDEN from this
    // viewer (null) is never named and never called unnamed — it has its own wording (`*_hidden`).
    const unnamed = t('homeModules.unnamed_animal');
    const nameOf = (animal: NamedAnimal) => animal.name.trim() || unnamed;
    const named = (key: string, animal: NamedAnimal | null) => animal
        ? t(key).replace('{animal}', nameOf(animal))
        : t(`${key}_hidden`);
    switch (status.kind) {
        case 'to_evaluate':
            if (!status.note) return null;
            return t(status.note.kind === 'replaced' ? 'evaluation.note_replaced' : 'evaluation.note_expired').replace('{date}', formatDate(status.note.at));
        case 'contract_sent':
            return t('evaluation.status_contract_sent').replace('{date}', formatDate(status.sentAt));
        case 'declined': {
            const line = t('evaluation.status_declined');
            // No date recorded: «No avanzó», without a dangling «·».
            return status.at != null ? line.replace('{date}', formatDate(status.at)) : line.replace(/\s*·\s*\{date\}/, '').replace('{date}', '');
        }
        case 'closed': {
            const reasonKey = status.reason === APPLICATION_CLOSE_REASONS.ADOPTED_OPEN_LINK ? 'evaluation.closed_open_link'
                : status.reason === APPLICATION_CLOSE_REASONS.ANIMAL_DELETED ? 'evaluation.closed_animal_deleted'
                    : 'evaluation.closed_other';
            const reason = ctx.animal ? animalLine(t, reasonKey, { name: nameOf(ctx.animal), sex: ctx.animal.sex }) : t(`${reasonKey}_hidden`);
            return t('evaluation.status_closed').replace('{reason}', reason);
        }
        case 'adopted': return named('evaluation.status_adopted', ctx.animal);
        case 'proposed': return ctx.outcomeAnimal?.adopted
            ? animalLine(t, 'evaluation.status_proposed_adopted', { name: nameOf(ctx.outcomeAnimal), sex: ctx.outcomeAnimal.sex })
            : named('evaluation.status_proposed', ctx.outcomeAnimal);
        case 'replaced': return t('evaluation.status_replaced');
        // Another team's animal (or an unnamed one) is never named here.
        case 'also_applied': return ctx.outcomeAnimal?.name.trim()
            ? named('evaluation.status_also_applied', ctx.outcomeAnimal)
            : t('evaluation.status_also_applied_other');
    }
}

export function ApplicationStatusLine({ status, animal, outcomeAnimal }: {
    status: ApplicationStatus;
    /** The animal the panel evaluates for (null: a general application). */
    animal: NamedAnimal | null;
    /** The animal a general application led to (ApplicantSummary.outcomeAnimal). */
    outcomeAnimal: NamedAnimal | null;
}) {
    const { t } = useLanguage();
    const { formatShortDate } = useDateFormat();
    const line = statusLineText(status, { animal, outcomeAnimal }, t, formatShortDate);
    if (!line) return null;
    // Still to decide (a retired link) reads amber like every to-do; a sent contract teal; an outcome muted.
    const tone = status.kind === 'to_evaluate'
        ? 'bg-amber-100 text-amber-700'
        : status.kind === 'contract_sent' || status.kind === 'adopted'
            ? 'bg-teal-50 text-teal-800'
            : 'bg-stone-100 text-stone-700';
    return (
        <p data-testid="applicant-status-line" data-status={status.kind} className={`rounded-xl px-3 py-2 text-sm font-semibold [overflow-wrap:anywhere] ${tone}`}>
            {line}
        </p>
    );
}

/**
 * The same sentence on the profile's «Solicitud» record (src/lib/applicationOutcomes.ts):
 * `statusLineText` is the single source, so the profile and the panel never differ.
 * Open applications have no line.
 */
export function ApplicationOutcomeLine({ outcome }: { outcome: { status: ApplicationStatus; animal: NamedAnimal | null; outcomeAnimal: NamedAnimal | null } }) {
    const { t } = useLanguage();
    const { formatShortDate } = useDateFormat();
    const line = statusLineText(outcome.status, { animal: outcome.animal, outcomeAnimal: outcome.outcomeAnimal }, t, formatShortDate);
    if (!line) return null;
    return (
        <p data-testid="record-outcome-line" data-status={outcome.status.kind} className="mt-2.5 text-sm font-semibold text-stone-700 [overflow-wrap:anywhere]">
            {line}
        </p>
    );
}
