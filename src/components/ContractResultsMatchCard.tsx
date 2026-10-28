'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { attachContractToExistingAdopter } from '@/app/actions/duplicates';
import { useShowToast } from '@/components/ui/Toast';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { HOUSEHOLD_NOT_CONVERTED, MINOR_SURVIVOR_HAS_ACTIVITY } from '@/domain/households';
import MatchCompare, { entriesAsShown } from '@/components/MatchCompare';
import { MatchCard } from '@/components/MatchCardParts';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { HouseholdLine } from '@/domain/households';

interface ContractResultsMatchCardProps {
    matchId: string;
    notificationId: string;
    profile: {
        id: string;
        name: string;
        contactInfo: string | null;
        /** Masked like contactInfo, as typed entries. */
        contactEntries?: string | null;
        status: string | null;
        /** Final fix P2: the same «Menor de edad» tag and household line as every card showing one person. */
        isMinor?: boolean;
        households?: HouseholdLine[];
        /** Their own standing in the card's header (audit B6). */
        rating?: number | null;
        openAlerts?: number;
    };
    matchTypes: string[];
    score?: number;
    /** What the adopter wrote in the contract — the rescuer's side of the comparison. */
    signer: { name: string; entries: Array<{ type: string; value: string }> };
    /** Open the comparison by itself — when this is the only possible match. */
    compareOpen?: boolean;
}

export default function ContractResultsMatchCard({
    matchId,
    notificationId,
    profile,
    matchTypes,
    score,
    signer,
    compareOpen = false,
}: ContractResultsMatchCardProps) {
    const { t } = useLanguage();
    const router = useRouter();
    const toast = useShowToast();
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [linking, setLinking] = useState(false);
    const [dismissed, setDismissed] = useState(false);

    const handleConfirm = async () => {
        setLinking(true);
        try {
            const result = await attachContractToExistingAdopter(notificationId, matchId);
            if (result.success) {
                toast.success(
                    (t('contractResults.link_success') || 'Adopción atribuida a {name}').replace('{name}', result.primaryName || profile.name),
                );
                router.push(result.matchedProfileUrl || `/adopter/${matchId}`);
                router.refresh();
            } else {
                // A merge rule's refusal says why (households as profiles); anything else, the generic line. Always with its id.
                const why = result.error === MINOR_SURVIVOR_HAS_ACTIVITY ? t('errors.merge_minor_survivor')
                    : result.error === HOUSEHOLD_NOT_CONVERTED ? t('errors.merge_household_not_converted')
                    : (t('errors.attach_contract_failed') || undefined);
                toast.error(t('contractResults.link_error') || 'No se pudo atribuir la adopción', why,
                    result.errorId ?? resolveErrorId(new Error(`attachContractToExistingAdopter: ${result.error}`), 'ContractResultsMatchCard'));
                setLinking(false);
                setConfirmOpen(false);
            }
        } catch (error) {
            toast.error(t('contractResults.link_error') || 'No se pudo atribuir la adopción', t('errors.attach_contract_failed') || undefined, resolveErrorId(error, 'ContractResultsMatchCard'));
            setLinking(false);
            setConfirmOpen(false);
        }
    };

    if (dismissed) return null;
    return (
        <>
            {/* The shared match card (audit B6): header (name + their own standing, household line) → «Qué coincide
                y qué no» → the same actions and labels as every match card. */}
            <div data-testid="contract-match-card" className="block bg-white rounded-xl border border-stone-200 p-4 shadow-sm">
                <MatchCard
                    person={profile}
                    compare={(
                        // What matches and what doesn't, field by field (Jon, 2026-10-25).
                        <MatchCompare
                            adopterId={profile.id}
                            matchTypes={matchTypes}
                            profileName={profile.name}
                            source={{ kind: 'contract', name: signer.name, entries: signer.entries }}
                            profileEntries={entriesAsShown(profile)}
                            score={score}
                            defaultOpen={compareOpen}
                            t={t}
                        />
                    )}
                    // «No es esta persona» takes the card off this page, as on a form's results.
                    actions={{ onSame: () => setConfirmOpen(true), busy: linking, onNotThis: () => setDismissed(true), notThisTestId: 'contract-match-not-this' }}
                />
            </div>

            {/* The shared dialog (role="dialog", focus, Escape); the same question as a form's «¿Vincular a …?». */}
            <ConfirmDialog
                open={confirmOpen}
                title={(t('formResults.confirm_link_title') || '¿Vincular a {name}?').replace('{name}', profile.name)}
                message={(t('contractResults.confirm_link_body') || 'Esta acción mueve el contrato firmado al perfil de {name}, elimina el perfil temporal recién creado y notifica al creador original.').replace('{name}', profile.name)}
                confirmLabel={linking ? (t('formResults.linking') || 'Vinculando…') : (t('formResults.confirm_link_action') || 'Sí, es la misma persona')}
                destructive={false}
                busy={linking}
                onConfirm={() => { void handleConfirm(); }}
                onCancel={() => setConfirmOpen(false)}
                testId="contract-link-confirm"
            />
        </>
    );
}
