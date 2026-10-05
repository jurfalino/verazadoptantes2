/**
 * Copy helpers for field-level collision messages (src/domain/fieldCollab.ts).
 * Every string comes from the `collab` locale block; these only fill in the
 * placeholders. A missing editor name (attribution not derivable) reads as
 * «otra persona del equipo» — never an email.
 */
type T = (key: string) => string;

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** The editor's display name, or the localized «otra persona del equipo». */
export function collabName(t: T, by: string | null | undefined): string {
    return by || t('collab.someone');
}

function lookup(t: T, group: 'field' | 'review', field: string): string {
    const key = `collab.${group}.${field}`;
    const v = t(key);
    return v === key ? t(`collab.${group}.other`) : v;
}

/** «el nombre», «la edad», … (with its article). */
export function collabField(t: T, field: string): string {
    return lookup(t, 'field', field);
}

/** «<Nombre> cambió el nombre mientras editabas.» */
export function conflictMessage(t: T, field: string, by: string | null | undefined): string {
    return capitalize(t('collab.conflict').replace('{name}', collabName(t, by)).replace('{field}', collabField(t, field)));
}

/** «<Nombre> había cambiado la edad: ya ves su versión.» */
export function updatedByOtherMessage(t: T, field: string, by: string | null | undefined): string {
    return capitalize(t('collab.updated_by_other').replace('{name}', collabName(t, by)).replace('{field}', collabField(t, field)));
}

/** «La edad necesita que la revises antes de guardar.» */
export function needsReviewMessage(t: T, field: string): string {
    return lookup(t, 'review', field);
}

/** «Actualizado por <Nombre>» */
export function updatedByLabel(t: T, by: string | null | undefined): string {
    return t('collab.updated_by').replace('{name}', collabName(t, by));
}

/** «<Nombre> cambió este dato mientras lo editabas.» / «Este dato ya no existe: <Nombre> lo borró.» */
export function entryConflictMessage(t: T, kind: 'changed' | 'deleted', by: string | null | undefined): string {
    return capitalize(t(kind === 'deleted' ? 'collab.entry_deleted' : 'collab.entry_changed').replace('{name}', collabName(t, by)));
}

export function theirVersionLabel(t: T, by: string | null | undefined): string {
    return t('collab.their_version').replace('{name}', collabName(t, by));
}

export function keepTheirsLabel(t: T, by: string | null | undefined): string {
    return t('collab.keep_theirs').replace('{name}', collabName(t, by));
}
