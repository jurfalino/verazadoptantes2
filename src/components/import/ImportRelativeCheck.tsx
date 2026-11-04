'use client';

/**
 * «¿Es este perfil?» for one relative a post names (households as profiles,
 * Task 4 carry): a rescuer is present in the importer, so the attended rule
 * applies — the same duplicate check as «Agregar familiar / conviviente»
 * (getHouseholdMatchCandidates) runs once for the relative, and each likely
 * match is offered in turn. «Sí» links that profile instead of making a new
 * one; «No» moves on; with none left the relative is made as new. Without an
 * answer the save makes a new profile, as before (the duplicate scan still
 * sends a likely match to «Pendientes de revisar»).
 */
import { useEffect, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { getHouseholdMatchCandidates } from '@/app/actions';
import type { HouseholdContactInput, HouseholdMatchCandidate } from '@/app/actions/households';
import { HouseholdCandidateCard } from '@/components/household/HouseholdCandidateCard';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { handledAsStale } from '@/lib/errorMessage';
import { fill } from '@/lib/householdCopy';

/** The relative's answer: a profile id to link, 'new', or undefined (not answered → new). */
export type RelativeChoice = string | 'new' | undefined;

export function ImportRelativeCheck({ name, contactEntries, excludeIds, choice, onChoose }: {
    name: string;
    contactEntries: HouseholdContactInput[];
    /** The profile the import lands on (never offered as the relative). */
    excludeIds: string[];
    choice: RelativeChoice;
    onChoose: (c: RelativeChoice, profileName?: string) => void;
}) {
    const { t } = useLanguage();
    const [candidates, setCandidates] = useState<HouseholdMatchCandidate[] | null>(null);
    /** The check failed (its errorId): said, never a silent «new» (final fix P5, like AddPersonForm). */
    const [checkFailed, setCheckFailed] = useState<string | null>(null);
    const key = JSON.stringify([name, contactEntries.map(c => c.value)]);

    useEffect(() => {
        let live = true;
        setCheckFailed(null);
        getHouseholdMatchCandidates({ name: name.trim() || undefined, contactEntries })
            .then(res => {
                if (!live) return;
                if (res.failed) {
                    setCheckFailed(res.errorId ?? resolveErrorId(new Error('getHouseholdMatchCandidates (import relative): failed'), 'ImportRelativeCheck'));
                    setCandidates([]);
                    return;
                }
                setCandidates(res.results.filter(r => !excludeIds.includes(r.adopterId)).slice(0, 3));
            })
            .catch((e: unknown) => {
                // A help, not a gate: without it the relative is added as new — and the rescuer is told.
                if (handledAsStale(e)) return;
                if (live) { setCheckFailed(resolveErrorId(e, 'ImportRelativeCheck')); setCandidates([]); }
            });
        return () => { live = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);

    if (choice && choice !== 'new') {
        const picked = candidates?.find(c => c.adopterId === choice);
        return (
            <p className="text-xs text-teal-800 px-3 pb-2" data-testid="import-relative-linked">
                {fill(t('import.relative_linked'), { name: picked?.adopter.name || name })}{' '}
                <button type="button" onClick={() => onChoose(undefined)} className="inline-flex min-h-[44px] items-center font-semibold underline">{t('import.relative_unlink')}</button>
            </p>
        );
    }
    if (checkFailed && choice !== 'new') {
        return (
            <p role="alert" data-testid="import-relative-check-failed" className="mx-3 mb-2 rounded-lg border px-3 py-2 text-xs break-words"
                style={{ background: 'var(--status-warning-bg)', borderColor: 'var(--status-warning-border)', color: 'var(--status-warning-text)' }}>
                {fill(t('import.relative_check_failed'), { name: name.trim() || t('adopter.nameless') })} (ID: {checkFailed})
            </p>
        );
    }
    if (choice === 'new' || !candidates || candidates.length === 0) return null;
    const current = candidates[0];
    return (
        <div className="px-2 pb-2" data-testid="import-relative-check">
            <HouseholdCandidateCard
                candidate={current}
                busy={false}
                testId="import-relative-candidate"
                onYes={() => onChoose(current.adopterId, current.adopter.name)}
                onNo={() => {
                    const rest = candidates.slice(1);
                    setCandidates(rest);
                    if (rest.length === 0) onChoose('new');
                }}
            />
        </div>
    );
}
