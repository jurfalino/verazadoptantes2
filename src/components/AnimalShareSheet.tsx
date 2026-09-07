'use client';

/**
 * v2.55.15 (animal-timeline PR2): ONE share door per animal.
 * v2.56.15: re-cut by INTENT rather than by artifact.
 *
 * The rows used to be named after the things they produce ("formulario",
 * "contrato") with one summary sentence above trying to explain when each
 * applies. A rescuer opening this sheet is not thinking "which artifact do I
 * want" — they are thinking "I found someone interested", "I need to vet them",
 * "we agreed, make it official", "this already happened". So each row now LEADS
 * with the situation and puts the control under it, and the sheet covers the
 * whole placement funnel end to end:
 *
 *   1. share the animal's public page   → contract-app /animal/:id
 *   2. vet the people who answer        → ShareFormMenu (unchanged)
 *   3. sign with the one you chose      → ShareMenu (unchanged)
 *   4. record one that already happened → PickAdopterForAnimalModal
 *
 * Row 1 is gated on data, not on a flag: /api/showcase/animal/[id] serves only
 * `recordType='available' AND adopter_id IS NULL` animals that have at least
 * one photo, and 404s otherwise — so a row offered without that check would
 * hand out a dead public link.
 */

import { useEffect, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { reportClientError } from '@/lib/clientErrorReporter';
import ShareFormMenu from '@/components/ShareFormMenu';
import ShareMenu from '@/components/ShareMenu';
import PickAdopterForAnimalModal from '@/components/PickAdopterForAnimalModal';

function Row({ intent, children }: { intent: string; children: React.ReactNode }) {
    return (
        <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
            <p className="text-xs text-stone-600 leading-snug mb-2">{intent}</p>
            {children}
        </div>
    );
}

export default function AnimalShareSheet({ userId, animalId, animalName, adopted = false, publicFiche = false, compact = false }: {
    userId: string;
    animalId: string;
    animalName: string;
    /** Post-adoption the contract row reads resend/receipt instead of the token pitch. */
    adopted?: boolean;
    /** The public /animal/:id page is actually reachable for this animal:
     *  still available (no active placement) AND it has at least one photo. */
    publicFiche?: boolean;
    compact?: boolean;
}) {
    const { t, locale } = useLanguage();
    const toast = useShowToast();
    const [open, setOpen] = useState(false);
    const [recordOpen, setRecordOpen] = useState(false);
    const [contractBase, setContractBase] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    // The public base differs per environment and cannot be inlined at build
    // time (NEXT_PUBLIC_* is baked into the artifact) — same runtime resolution
    // ShowcaseUrlChips uses. Fetched lazily, only once the sheet is opened.
    useEffect(() => {
        if (!open || !publicFiche || contractBase !== null) return;
        let cancelled = false;
        fetch('/api/my-showcase-info')
            .then(r => r.ok ? r.json() as Promise<{ contractBase?: string }> : null)
            .then((info) => {
                if (!cancelled) setContractBase((info?.contractBase || '').replace(/\/+$/, ''));
            })
            .catch(() => { if (!cancelled) setContractBase(''); });
        return () => { cancelled = true; };
    }, [open, publicFiche, contractBase]);

    // Stamp the sharer's language so the contract-app renders in it (it
    // defaults to es) — same convention as ShowcaseUrlChips.
    const publicUrl = contractBase ? `${contractBase}/animal/${animalId}?lang=${locale}` : null;

    const handleCopy = async () => {
        if (!publicUrl) return;
        try {
            await navigator.clipboard.writeText(publicUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
            toast.success(t('myAnimals.showcase_copied') || 'Link copiado', '');
        } catch (e) {
            // A clipboard denial is a real failure the rescuer will report —
            // give the toast an id like every other error toast in the app.
            const errorId = await reportClientError({
                message: e instanceof Error ? e.message : String(e),
                source: 'AnimalShareSheet.copyPublicUrl',
                extra: { animalId },
            });
            toast.error(t('errors.generic') || 'Error', t('myAnimals.showcase_copy_failed') || 'No se pudo copiar.', errorId);
        }
    };

    const pill = 'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-colors';

    return (
        <>
            <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setOpen(true); }}
                data-testid={`share-sheet-${animalId}`}
                className={compact
                    ? 'inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-stone-100 text-stone-700 hover:bg-stone-200 transition-colors'
                    : 'inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-teal-50 text-teal-700 border border-teal-100 hover:border-teal-400 transition-colors'}
                aria-haspopup="dialog"
            >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8.5 5.5L12 2l3.5 3.5M12 2v13M5 9.5H4V22h16V9.5h-1" /></svg>
                {t('animalProfile.share') || 'Compartir'}
            </button>

            {open && (
                <div
                    className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
                    onClick={() => setOpen(false)}
                    role="presentation"
                >
                    <div
                        className="bg-white rounded-2xl border border-stone-200 shadow-xl w-full max-w-sm p-4 max-h-[90vh] overflow-y-auto"
                        role="dialog"
                        aria-modal="true"
                        aria-label={t('animalProfile.share_title') || 'Compartir'}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3 className="text-base font-bold text-stone-900 mb-3">{t('animalProfile.share_title') || 'Compartir'}</h3>

                        {/* The row triggers stay mounted while their own modals stack on
                            top — closing this sheet here would unmount them and their
                            modals with them. Closing the inner modal lands back here. */}
                        <div className="flex flex-col gap-2">

                            {publicFiche && (
                                <Row intent={t('animalProfile.share_intent_public') || 'Si querés compartir su ficha con un adoptante interesado'}>
                                    {publicUrl ? (
                                        <div className="flex flex-wrap items-center gap-2">
                                            <button
                                                type="button" onClick={handleCopy}
                                                className={`${pill} text-teal-700 bg-teal-50 hover:bg-teal-100`}
                                                data-testid={`share-public-copy-${animalId}`}
                                            >
                                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                                                {copied ? (t('myAnimals.showcase_copied') || 'Copiado') : (t('myAnimals.showcase_copy') || 'Copiar link')}
                                            </button>
                                            <a
                                                href={publicUrl} target="_blank" rel="noopener noreferrer"
                                                className={`${pill} text-stone-700 bg-stone-100 hover:bg-stone-200`}
                                            >
                                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                                                {t('myAnimals.showcase_open') || 'Abrir'}
                                            </a>
                                        </div>
                                    ) : (
                                        <span className="text-xs text-stone-500">{t('common.loading') || 'Cargando…'}</span>
                                    )}
                                </Row>
                            )}

                            <Row intent={t('animalProfile.share_intent_form') || 'Si querés evaluar adoptantes'}>
                                <ShareFormMenu userId={userId} animalId={animalId} animalName={animalName} />
                            </Row>

                            <Row intent={adopted
                                ? (t('animalProfile.share_intent_contract_adopted') || 'Si querés reenviar el contrato o guardar la constancia firmada')
                                : (t('animalProfile.share_intent_contract') || 'Si ya tenés un adoptante y querés que firme un contrato digital')}>
                                <ShareMenu contractUrl={`/contract/${animalId}`} animalName={animalName} />
                            </Row>

                            {!adopted && (
                                <Row intent={t('animalProfile.share_intent_record') || 'Si querés registrar una adopción ya concretada'}>
                                    <button
                                        type="button"
                                        onClick={() => { setOpen(false); setRecordOpen(true); }}
                                        className={`${pill} text-white bg-teal-600 hover:bg-teal-700`}
                                        data-testid={`share-record-adoption-${animalId}`}
                                    >
                                        {t('myAnimals.record_adoption') || 'Registrar adopción'}
                                    </button>
                                </Row>
                            )}
                        </div>

                        <button
                            type="button"
                            onClick={() => setOpen(false)}
                            className="mt-3 w-full px-4 py-2 rounded-xl text-sm font-semibold text-stone-600 bg-stone-100 hover:bg-stone-200 transition-colors"
                        >
                            {t('common.close') || 'Cerrar'}
                        </button>
                    </div>
                </div>
            )}

            {/* Self-contained: the picker takes the animal and routes to the
                adopter wizard itself, so the card gets the same one-click path
                to «ya concretada» that the profile's primary button offers. */}
            <PickAdopterForAnimalModal
                animalId={animalId}
                animalName={animalName}
                open={recordOpen}
                onClose={() => setRecordOpen(false)}
                recordType="adoption"
            />
        </>
    );
}
