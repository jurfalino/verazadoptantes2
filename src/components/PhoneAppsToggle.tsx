'use client';

import { MESSAGING_APPS, type MessagingApp } from '@/lib/contactEntries';
import { MessagingLogo } from './MessagingLogo';

/**
 * WhatsApp / Telegram toggles for a phone contact entry. Independent multi-select
 * (both, one, or none) — there is no auto-detection, the rescuer ticks them.
 * Used by the manual composer and the import row editor.
 */
export function PhoneAppsToggle({ value, onChange, size = 18 }: {
    value: MessagingApp[];
    onChange: (apps: MessagingApp[]) => void;
    size?: number;
}) {
    const has = (k: MessagingApp) => value.includes(k);
    const toggle = (k: MessagingApp) => onChange(has(k) ? value.filter(a => a !== k) : [...value, k]);
    return (
        <div className="flex gap-2 flex-wrap items-center">
            {MESSAGING_APPS.map(app => {
                const on = has(app.key);
                return (
                    <button
                        key={app.key}
                        type="button"
                        aria-pressed={on}
                        aria-label={app.label}
                        onClick={() => toggle(app.key)}
                        className={`inline-flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 rounded-full border text-xs font-semibold transition-all ${on
                            ? 'border-teal-500 text-stone-800 bg-teal-50/60'
                            : 'border-stone-200 text-stone-500 hover:border-teal-300'}`}
                    >
                        <MessagingLogo app={app.key} size={size} />
                        {app.label}
                        <span className={`w-3.5 h-3.5 rounded flex items-center justify-center text-[9px] text-white border ${on ? 'bg-teal-600 border-teal-600' : 'border-stone-300'}`}>{on ? '✓' : ''}</span>
                    </button>
                );
            })}
        </div>
    );
}
