'use client';

import { SOCIAL_PLATFORMS, type SocialPlatform } from '@/lib/contactEntries';
import { SocialLogo } from './SocialLogo';

/**
 * Network picker for a social contact entry. When `locked` (the platform was
 * deduced from a URL) it shows ONLY that logo — not changeable, per product
 * decision. Otherwise it shows all networks as logo buttons (no labels); the
 * selected one is highlighted. Used by the manual composer and the import row.
 */
export function SocialPlatformPicker({ value, locked, onChange, size = 20 }: {
    value: SocialPlatform | null;
    locked: boolean;
    onChange: (p: SocialPlatform) => void;
    size?: number;
}) {
    if (locked && value) {
        return (
            <span className="inline-flex items-center gap-1.5" title="Detectado por la URL">
                <SocialLogo platform={value} size={size} />
                <span className="text-[10px] font-bold uppercase tracking-wide text-teal-700 bg-teal-50 border border-teal-200 rounded-full px-1.5 py-px">auto</span>
            </span>
        );
    }
    return (
        <div className="flex gap-1.5 flex-wrap">
            {SOCIAL_PLATFORMS.map(pl => {
                const active = value === pl.key;
                return (
                    <button
                        key={pl.key}
                        type="button"
                        title={pl.label}
                        aria-label={pl.label}
                        aria-pressed={active}
                        onClick={() => onChange(pl.key)}
                        className={`p-1.5 rounded-lg border transition-all ${active
                            ? 'border-teal-500 ring-2 ring-teal-500/20 bg-white'
                            : 'border-stone-200 opacity-60 hover:opacity-100 hover:border-teal-300 bg-white'}`}
                    >
                        <SocialLogo platform={pl.key} size={size} />
                    </button>
                );
            })}
        </div>
    );
}
