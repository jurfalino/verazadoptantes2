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
            className={`relative inline-flex flex-shrink-0 items-center justify-start h-6 w-11 my-2.5 rounded-full transition-colors disabled:opacity-50 ${on ? 'bg-teal-600' : 'bg-stone-300'}`}
        >
            {/* 4px: half-grid exception, centres the 20px thumb in a 24px track */}
            <span
                className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[22px]' : 'translate-x-[2px]'}`}
            />
        </button>
    );

    // ── the card ──
    // The card already has a vocabulary for state, and it is sentences: "In
    // foster with X", "Adopted by X", "View Signed Contract", the amber
    // «pendientes» row — each a full-width row with an icon and words. A bare
    // eye icon matched none of it: on a phone there is no hover, so the
    // commonest state became an unexplained symbol, which is recall where the
    // rest of the card offers recognition.
    //
    // So: the same full-width row the card uses for everything else, saying
    // what is true in words, with the switch at the end so it reads as
    // something you can change. The whole row is the control — one target, not
    // a 20px icon. Three states, because "on" has two very different meanings:
    //   listed + photo  → teal, it is working
    //   listed, no photo → amber, it WANTS to be listed and cannot (your move)
    //   not listed       → stone, a deliberate choice, not a fault
    if (compact) {
        const tone = !on
            ? { box: 'bg-stone-100 text-stone-700 hover:bg-stone-200', track: 'bg-stone-400' }
            : hasPhoto
                ? { box: 'bg-teal-50 text-teal-800 hover:bg-teal-100', track: 'bg-teal-600' }
                : { box: 'bg-amber-100 text-amber-800 hover:bg-amber-200', track: 'bg-amber-500' };
        const cardLabel = !on
            ? (t('myAnimals.listing_off') || 'Fuera del catálogo')
            : hasPhoto
                ? (t('myAnimals.listing_on') || 'En el catálogo público')
                : (t('myAnimals.listing_card_needs_photo') || 'Falta una foto para que aparezca');
        return (
            <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={label}
                disabled={busy}
                onClick={(e) => { e.stopPropagation(); e.preventDefault(); toggle(); }}
                data-testid={`listing-toggle-${animalId}`}
                className={`flex items-center gap-2 w-full min-h-[44px] px-3 py-2 rounded-lg text-xs font-bold transition-colors disabled:opacity-50 ${tone.box}`}
            >
                {on ? (
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden>
                        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" />
                    </svg>
                ) : (
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden>
                        <path d="M9.9 5.1A9.5 9.5 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 4.3-1M3 3l18 18" />
                    </svg>
                )}
                <span className="flex-1 min-w-0 text-left truncate">{cardLabel}</span>
                {/* Reads as "you can change this", which an icon alone does not. */}
                <span className={`relative inline-flex flex-shrink-0 items-center h-5 w-9 rounded-full transition-colors ${tone.track}`} aria-hidden>
                    <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[18px]' : 'translate-x-[2px]'}`} />
                </span>
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
