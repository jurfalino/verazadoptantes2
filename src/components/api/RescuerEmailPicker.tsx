'use client';

/**
 * Admin → API «Email del rescatista»: type part of a name or email, pick the
 * rescuer from /api/admin/users/search (admin-only, up to 20 matches). The
 * field stays a plain email input, so a pasted address still works; picking
 * just fills it. Keyboard: ↓/↑ move, Enter picks, Esc closes.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { resolveErrorId } from '@/lib/clientErrorReporter';

interface UserOption { email: string; name: string | null }

export default function RescuerEmailPicker({ value, onChange, inputClassName }: {
    value: string;
    onChange: (email: string) => void;
    inputClassName: string;
}) {
    const { t } = useLanguage();
    const listId = useId();
    const [options, setOptions] = useState<UserOption[]>([]);
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(-1);
    const [failedId, setFailedId] = useState<string | null>(null);
    const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
    const seq = useRef(0);

    const search = async (q: string) => {
        const mine = ++seq.current;
        try {
            const res = await fetch(`/api/admin/users/search?q=${encodeURIComponent(q)}`);
            if (!res.ok) throw new Error(`users search HTTP ${res.status}`);
            const data = await res.json() as { users?: UserOption[] };
            if (mine !== seq.current) return; // an older, slower answer
            // One row per email (a stray duplicate user row would repeat it).
            const seen = new Set<string>();
            setOptions((data.users ?? []).filter(u => { const k = u.email.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }));
            setActive(-1); setFailedId(null);
        } catch (e) {
            if (mine !== seq.current) return;
            // Typing the full email still works; say the suggestions failed, with an id.
            setOptions([]); setFailedId(resolveErrorId(e, 'RescuerEmailPicker.search'));
        }
    };

    useEffect(() => () => { if (debounce.current) clearTimeout(debounce.current); }, []);

    const type = (v: string) => {
        onChange(v);
        setOpen(true);
        if (debounce.current) clearTimeout(debounce.current);
        debounce.current = setTimeout(() => { void search(v.trim()); }, 200);
    };

    const pick = (u: UserOption) => { onChange(u.email); setOpen(false); setActive(-1); };

    return (
        <div className="relative">
            <input
                className={`${inputClassName} w-72 max-w-full`}
                type="email"
                required
                value={value}
                placeholder={t('apiAdmin.owner_search_placeholder')}
                autoComplete="off"
                role="combobox"
                aria-expanded={open && options.length > 0}
                aria-controls={listId}
                aria-autocomplete="list"
                data-testid="api-owner-email"
                onFocus={() => { setOpen(true); if (options.length === 0) void search(value.trim()); }}
                onBlur={() => setTimeout(() => setOpen(false), 150)}
                onChange={e => type(e.target.value)}
                onKeyDown={e => {
                    if (!open || options.length === 0) return;
                    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(i + 1, options.length - 1)); }
                    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
                    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(options[active]); }
                    else if (e.key === 'Escape') setOpen(false);
                }}
            />
            {open && options.length > 0 && (
                <ul id={listId} role="listbox" data-testid="api-owner-options"
                    className="absolute z-20 mt-1 w-80 max-w-[90vw] max-h-64 overflow-y-auto rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 shadow-lg divide-y divide-stone-100 dark:divide-stone-800">
                    {options.map((u, i) => (
                        <li key={u.email} role="option" aria-selected={i === active}>
                            <button type="button"
                                className={`w-full text-left px-3 py-2 text-sm font-normal ${i === active ? 'bg-teal-50 dark:bg-stone-800' : 'hover:bg-teal-50 dark:hover:bg-stone-800'}`}
                                onMouseDown={e => e.preventDefault()}
                                onClick={() => pick(u)}>
                                <span className="block text-stone-800 dark:text-stone-200">{u.name || u.email}</span>
                                {u.name && <span className="block text-xs text-stone-500 break-all">{u.email}</span>}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            {failedId && <p className="mt-1 text-xs font-normal text-stone-500">{t('apiAdmin.owner_search_failed')} (ID: {failedId})</p>}
        </div>
    );
}
