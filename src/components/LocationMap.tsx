'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, MapPin, ExternalLink } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { buttonClasses } from '@/components/ui/Button';
import { parseCoords, osmEmbedUrl, googleMapsUrl } from '@/lib/mapUrls';

/**
 * The applicant's device-reported position as a map you open, instead of two
 * raw numbers nobody can read.
 *
 * Collapsed by default, and the iframe is only mounted once opened: closed, no
 * request leaves for the map provider, so viewing a form doesn't hand the
 * applicant's location to a third party and the page stays as light as it was.
 *
 * `card` is the form-results section (same shell as its CollapsibleSection);
 * `inline` is a one-line toggle for tighter surfaces like the applicant panel.
 * Renders nothing for missing or invalid coordinates.
 */
export default function LocationMap({
    latitude,
    longitude,
    title,
    variant = 'card',
}: {
    latitude: string | null | undefined;
    longitude: string | null | undefined;
    title: string;
    variant?: 'card' | 'inline';
}) {
    const { t } = useLanguage();
    const [open, setOpen] = useState(false);
    const panelId = useId();
    const panelRef = useRef<HTMLDivElement>(null);
    // Opened near the bottom of a phone screen, the map would start below the
    // fold: bring it into view so the tap visibly does something.
    useEffect(() => {
        if (open) panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, [open]);
    const coords = parseCoords(latitude, longitude);
    if (!coords) return null;

    const body = open && (
        <div id={panelId} ref={panelRef} className="space-y-2 scroll-mb-4">
            {/* No loading="lazy": the iframe only exists once someone asked for
                it, and lazy left it blank when it opened below the fold. */}
            <iframe
                src={osmEmbedUrl(coords)}
                title={t('locationMap.map_title')}
                referrerPolicy="no-referrer"
                className="w-full h-64 sm:h-80 rounded-xl border border-stone-200 bg-stone-100"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-stone-500">{t('locationMap.hint')}</p>
                <a
                    href={googleMapsUrl(coords)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={buttonClasses({ variant: 'secondary', size: 'compact' })}
                >
                    {t('locationMap.open_in_maps')}
                    <ExternalLink className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
                </a>
            </div>
        </div>
    );

    if (variant === 'inline') {
        return (
            <div className="space-y-2">
                <button
                    type="button"
                    onClick={() => setOpen(o => !o)}
                    aria-expanded={open}
                    aria-controls={panelId}
                    className="inline-flex items-center gap-1 min-h-[44px] text-xs font-semibold text-teal-700 hover:text-teal-800"
                >
                    <MapPin className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
                    {open ? t('locationMap.hide_map') : t('locationMap.show_map')}
                </button>
                {body}
            </div>
        );
    }

    return (
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden mb-4 shadow-sm">
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                aria-expanded={open}
                aria-controls={panelId}
                className="w-full flex items-center gap-2 px-4 py-3 text-left text-sm font-semibold text-stone-700 hover:bg-[var(--accent-subtle-bg)] transition-colors"
            >
                {open ? <ChevronDown className="w-4 h-4 shrink-0" aria-hidden="true" /> : <ChevronRight className="w-4 h-4 shrink-0" aria-hidden="true" />}
                <MapPin className="w-4 h-4 shrink-0 text-teal-700" strokeWidth={2} aria-hidden="true" />
                <span className="flex-1">{title}</span>
            </button>
            {open && <div className="px-4 pb-4">{body}</div>}
        </div>
    );
}
