'use client';

import { useLanguage } from '@/context/LanguageContext';

/**
 * One translated string inside a server component (which can't call `useLanguage`):
 * `<Tr k="contractResults.title" />`, with `{name}`-style placeholders filled from `vars`.
 */
export function Tr({ k, vars }: { k: string; vars?: Record<string, string | number> }) {
    const { t } = useLanguage();
    let s = t(k);
    for (const [name, value] of Object.entries(vars ?? {})) s = s.split(`{${name}}`).join(String(value));
    return <>{s}</>;
}
