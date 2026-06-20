'use client';

import { useLanguage } from '@/context/LanguageContext';

interface Props {
    sourceUrl?: string | null;
}

export function PublicProfileSourceNotice({ sourceUrl }: Props) {
    const { t } = useLanguage();
    // v2.19.57: only render the link for http(s) URLs. Server validation also
    // enforces this (validation.ts httpUrl primitive), but a stored value that
    // predates the check — or any future write path that bypasses the schema —
    // could still smuggle a `javascript:` or `data:` URI through. The href
    // attribute on <a> is a stored-XSS sink, so we defend in depth at render.
    const safeSourceUrl = sourceUrl && /^https?:\/\//i.test(sourceUrl) ? sourceUrl : null;
    return (
        <div
            className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 flex items-start gap-3"
            role="note"
        >
            <svg
                className="w-5 h-5 shrink-0 mt-0.5 text-blue-700"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                viewBox="0 0 24 24"
                aria-hidden="true"
            >
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="flex-1 min-w-0 text-sm text-blue-700">
                <p>{t('adopter.public_profile_source_notice')}</p>
                {safeSourceUrl && (
                    <a
                        href={safeSourceUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="mt-1 inline-block font-medium underline underline-offset-2 hover:opacity-80"
                    >
                        {t('adopter.public_profile_source_link')} →
                    </a>
                )}
            </div>
        </div>
    );
}
