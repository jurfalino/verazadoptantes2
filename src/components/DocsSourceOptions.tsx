'use client';

/**
 * The «Al compartir, usar:» option list — one component for every surface
 * that asks which form, contract (and, with group branding, look) a rescuer's
 * shared links use: the Settings card (AdoptionDocsSettingsSection) and the
 * «¿Qué formulario y contrato usás al compartir?» dialog shown when her groups
 * change (DocsSourceDialog). Same rows, logos, names, sub-lines and pills on
 * both (Nielsen #4).
 *
 * Controlled: the caller owns the selected value and decides when to save.
 * Keep this file free of '@/domain/adoptionDocs' (zod at module scope).
 */

import type { ReactNode } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import type { DocsSummary } from '@/app/actions/adoptionDocs';

export type DocsOverview = { source: string; self: DocsSummary; orgs: Array<{ id: string; name: string; branded?: boolean; logoUrl?: string | null } & DocsSummary> };

export function Pill({ customized }: { customized: boolean }) {
    const { t } = useLanguage();
    return (
        <span className={`shrink-0 px-2 py-1 rounded-full leading-none text-[11px] font-semibold border ${customized
            ? 'bg-teal-50 text-teal-700 border-teal-200'
            : 'bg-stone-100 text-stone-500 border-stone-200'}`}>
            {customized ? t('adoptionDocs.pill_custom') : t('adoptionDocs.pill_standard')}
        </span>
    );
}

/** 32px lead for a row: group logo, initials tile (no logo) or a person (own). Decorative: the row text names it. */
function Thumb({ kind, name, logoUrl, testId }: { kind: 'self' | 'org'; name?: string; logoUrl?: string | null; testId: string }) {
    const box = 'shrink-0 w-8 h-8 rounded-lg border border-stone-200 bg-stone-100 text-stone-500 flex items-center justify-center overflow-hidden';
    if (kind === 'org' && logoUrl) {
        // eslint-disable-next-line @next/next/no-img-element
        return <span className={box} data-testid={testId}><img src={logoUrl} alt="" className="w-full h-full object-cover" /></span>;
    }
    if (kind === 'org') {
        const initials = (name || '').split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
        return <span className={`${box} text-xs font-bold`} data-testid={testId} aria-hidden="true">{initials || '?'}</span>;
    }
    return (
        <span className={box} data-testid={testId} aria-hidden="true">
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>
        </span>
    );
}

/**
 * The radio rows. `inUse`: the source her links use right now — marked
 * «(el que usás)» (the dialog passes it; the Settings card, where the checked
 * row already is the one in use, does not). `legend` labels the fieldset.
 */
export function DocsSourceOptions({ overview, value, onChange, branding, disabled = false, radioName, legend, inUse }: {
    overview: DocsOverview;
    value: string;
    onChange: (next: string) => void;
    branding: boolean;
    disabled?: boolean;
    radioName: string;
    legend: ReactNode;
    inUse?: string;
}) {
    const { t } = useLanguage();
    const options = [
        { value: 'self', label: t('adoptionDocs.use_mine'), customized: overview.self.customized, kind: 'self' as const, name: '', logoUrl: null as string | null | undefined, look: 'look_standard' },
        ...overview.orgs.map(o => ({
            value: `org:${o.id}`,
            label: t('adoptionDocs.use_group').replace('{name}', o.name),
            customized: o.customized,
            kind: 'org' as const,
            name: o.name,
            logoUrl: o.logoUrl,
            look: o.branded ? 'look_branded' : 'look_unbranded',
        })),
    ];
    const marker = (v: string) => inUse === v
        ? <span className="font-normal text-stone-500" data-testid={`adoption-docs-in-use-${v}`}> {t('adoptionDocs.in_use')}</span>
        : null;

    return (
        <fieldset disabled={disabled} className="min-w-0">
            {legend}
            <div>
                {options.map(o => (
                    branding ? (
                        <label key={o.value} className="flex items-center gap-4 min-h-11 py-2 px-2 rounded-xl cursor-pointer hover:bg-stone-50 transition-colors">
                            <input
                                type="radio"
                                name={radioName}
                                value={o.value}
                                checked={value === o.value}
                                onChange={() => onChange(o.value)}
                                className="w-4 h-4 shrink-0 accent-teal-600"
                            />
                            <Thumb kind={o.kind} name={o.name} logoUrl={o.logoUrl} testId={`adoption-docs-thumb-${o.value}`} />
                            <span className="flex-1 min-w-0">
                                <span className="block text-sm font-medium text-stone-800 break-words">{o.label}{marker(o.value)}</span>
                                <span className="block text-xs text-stone-500 break-words" data-testid={`adoption-docs-look-${o.value}`}>{t(`adoptionDocs.${o.look}`)}</span>
                            </span>
                            <Pill customized={o.customized} />
                        </label>
                    ) : (
                        <label key={o.value} className="flex items-center gap-4 min-h-11 px-2 rounded-xl cursor-pointer hover:bg-stone-50 transition-colors">
                            <input
                                type="radio"
                                name={radioName}
                                value={o.value}
                                checked={value === o.value}
                                onChange={() => onChange(o.value)}
                                className="w-4 h-4 accent-teal-600"
                            />
                            <span className="flex-1 min-w-0 text-sm font-medium text-stone-800 break-words">{o.label}{marker(o.value)}</span>
                            <Pill customized={o.customized} />
                        </label>
                    )
                ))}
            </div>
        </fieldset>
    );
}
