'use client';

/**
 * v2.56.128 — "is this animal in the public catalogue?"
 *
 * Being in the catalogue is three things at once: the animal has no permanent
 * home yet, it has a photo to show, and the rescuer wants it seen. Only the
 * last is a switch; the first two are facts. So this never shows a bare
 * on/off — it says which of the three is missing, because "I turned it on and
 * nothing happened" is the failure that makes a rescuer stop trusting it.
 *
 *  · adopted            → not rendered at all. The animal has a home; there is
 *                         nothing to decide, and a disabled switch would only
 *                         invite the question.
 *  · on, with a photo   → "En el catálogo público"
 *  · on, with no photo  → on, but says a photo is what is missing
 *  · off                → "Fuera del catálogo", whatever else is true
 *
 * Optimistic: the switch moves at once and rolls back if the write fails,
 * because the honest alternative is a switch that lags a round trip on every
 * tap. The error carries an errorId like every other failure in the app.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { setAnimalListed } from '@/app/actions';

export default function AnimalListingToggle({
    animalId, listed, hasPhoto, compact = false,
}: {
    animalId: string;
    /** The stored switch. NULL in the DB means listed, resolved by the caller. */
    listed: boolean;
    /** At least one photo the catalogue can actually draw. */
    hasPhoto: boolean;
    /** Card variant: one pill, no explanation. */
    compact?: boolean;
}) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const router = useRouter();
    const [, startTransition] = useTransition();
    const [on, setOn] = useState(listed);
    const [busy, setBusy] = useState(false);

    // Props win whenever the server says something new (a refresh, another
    // tab, a teammate): `useState` latches at mount and would otherwise show
    // a stale switch forever.
    const [lastProp, setLastProp] = useState(listed);
    if (lastProp !== listed) { setLastProp(listed); setOn(listed); }

    const toggle = async () => {
        if (busy) return;
        const next = !on;
        setOn(next);            // optimistic
        setBusy(true);
        try {
            const res = await setAnimalListed(animalId, next);
            if (res && 'error' in res) {
                setOn(!next);
                toast.error(t('errors.generic') || 'Error', res.error);
                return;
            }
            startTransition(() => router.refresh());
        } catch (e) {
            setOn(!next);
            toast.error(
                t('errors.generic') || 'Error',
                t('myAnimals.listing_failed') || 'No se pudo cambiar la visibilidad.',
                resolveErrorId(e, 'AnimalListingToggle'),
            );
        } finally {
            setBusy(false);
        }
    };

    const label = on
        ? (t('myAnimals.listing_on') || 'En el catálogo público')
        : (t('myAnimals.listing_off') || 'Fuera del catálogo');

    const Switch = (
        <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label={label}
            disabled={busy}
            onClick={(e) => { e.stopPropagation(); e.preventDefault(); toggle(); }}
            data-testid={`listing-toggle-${animalId}`}
            className={`relative inline-flex flex-shrink-0 items-center h-6 w-11 rounded-full transition-colors disabled:opacity-50 ${on ? 'bg-teal-600' : 'bg-stone-300'}`}
        >
            {/* 4px: half-grid exception, centres the 20px thumb in a 24px track */}
            <span
                className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[22px]' : 'translate-x-[2px]'}`}
            />
        </button>
    );

    // ── the card ──
    // Measured: the labelled switch took 184px of a 339px row and squeezed the
    // card's own date and «Actualizado por» to 31px — an ellipsis — without
    // overflowing, so it degraded silently. A card is signals plus one quick
    // action, not a form.
    //
    // So: quiet in the normal state, loud in the exceptional one. Nearly every
    // animal is listed, and saying so on every card is 184px of noise; an
    // animal that is HIDDEN is the thing worth seeing at a glance. Listed is a
    // bare eye (~36px), hidden is eye-off plus the word, in amber. Both keep
    // role="switch" and the full sentence in aria-label/title, so the meaning
    // is one hover or one screen-reader stop away. The full labelled control
    // lives on the animal's own page, where there is room for it.
    if (compact) {
        return (
            <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={label}
                title={label}
                disabled={busy}
                onClick={(e) => { e.stopPropagation(); e.preventDefault(); toggle(); }}
                data-testid={`listing-toggle-${animalId}`}
                className={`inline-flex flex-shrink-0 items-center gap-1.5 min-h-[36px] px-2 rounded-lg text-xs font-bold transition-colors disabled:opacity-50 ${
                    on ? 'text-stone-400 hover:text-stone-600 hover:bg-stone-100' : 'text-amber-700 bg-amber-50 hover:bg-amber-100'}`}
            >
                {on ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden>
                        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" />
                    </svg>
                ) : (
                    <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden>
                            <path d="M9.9 5.1A9.5 9.5 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 4.3-1M3 3l18 18" />
                        </svg>
                        {t('myAnimals.listing_off_short') || 'Oculto'}
                    </>
                )}
            </button>
        );
    }

    return (
        <div className="flex items-start gap-3 p-3 rounded-xl border border-stone-200 bg-stone-50">
            {Switch}
            <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-stone-900">{label}</p>
                <p className="mt-0.5 text-xs text-stone-600 leading-relaxed" data-testid={`listing-hint-${animalId}`}>
                    {!on
                        ? (t('myAnimals.listing_off_hint') || 'No aparece en el catálogo. Usalo mientras esté en tratamiento o ya prometido — sus datos y sus fotos quedan como están.')
                        : hasPhoto
                            ? (t('myAnimals.listing_on_hint') || 'Cualquiera puede verlo en el catálogo y postularse para adoptarlo.')
                            : (t('myAnimals.listing_needs_photo') || 'Le falta una foto: hasta que subas una no va a aparecer en el catálogo.')}
                </p>
            </div>
        </div>
    );
}
