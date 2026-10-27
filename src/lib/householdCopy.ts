/**
 * What the household actions' error codes say to a rescuer (households as
 * profiles, Task 8) — one mapper for the household section, the add form,
 * «Editar», the gift block and the importer. Pure: takes `t`.
 *
 * Two kinds of answer:
 * - an expected refusal (`refused: true`): the rescuer can act on it — a
 *   warning, never a tracked error (no errorId);
 * - a failure (`failed`, `busy`, anything unknown): an error toast with the
 *   server's errorId (or one the caller reports).
 */
import { HOUSEHOLD_NOT_CONVERTED, MINOR_SURVIVOR_HAS_ACTIVITY } from '@/domain/households';
import { CONTACT_ENTRIES_FULL } from '@/lib/contactEntries';

type T = (key: string) => string;

const REFUSALS: Record<string, string> = {
    identifier_required: 'adopter.hh_err_identifier_required',
    household_full: 'adopter.hh_err_household_full',
    too_many_households: 'adopter.hh_err_too_many_households',
    not_authorized: 'adopter.hh_err_not_authorized',
    not_found: 'adopter.hh_err_not_found',
    conflict: 'adopter.hh_err_conflict',
    already_there: 'adopter.hh_err_already_there',
    invalid: 'adopter.hh_err_invalid',
    has_activity: 'adopter.age_has_activity',
    not_authenticated: 'adopter.hh_err_not_authorized',
    [CONTACT_ENTRIES_FULL]: 'adopter.ce_add_full',
    rate_limited: 'adopter.rename_rate_limited',
    [MINOR_SURVIVOR_HAS_ACTIVITY]: 'errors.merge_minor_survivor',
    [HOUSEHOLD_NOT_CONVERTED]: 'errors.merge_household_not_converted',
};

export type HouseholdErrorCopy = { refused: boolean; message: string };

export function householdErrorCopy(t: T, error: string | null | undefined): HouseholdErrorCopy {
    const key = error ? REFUSALS[error] : undefined;
    if (key) return { refused: true, message: t(key) };
    if (error === 'busy') return { refused: false, message: t('collab.busy') };
    return { refused: false, message: t('adopter.hh_err_failed') };
}

/** «Pedro Paez y Marta Paez» / «A, B y C» — a list of names in the viewer's language. */
export function joinNames(t: T, names: readonly string[]): string {
    const list = names.filter(n => n && n.trim());
    if (list.length <= 1) return list[0] ?? '';
    return `${list.slice(0, -1).join(', ')} ${t('adopter.hh_list_and')} ${list[list.length - 1]}`;
}

/** The first word of a name («Pedro» of «Pedro Paez»), as the household copy speaks of people. */
export function firstName(name: string | null | undefined): string {
    return (name ?? '').trim().split(/\s+/)[0] ?? '';
}

/** `{key}` placeholders filled in (every occurrence). */
export function fill(s: string, vars: Record<string, string | number>): string {
    return Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(String(v)), s);
}
