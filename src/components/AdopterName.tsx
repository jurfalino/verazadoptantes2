// src/components/AdopterName.tsx
'use client';
import { useLanguage } from '@/context/LanguageContext';
import { isNamelessAdopter } from '@/lib/adopterDisplay';

interface AdopterNameProps {
    adopter: { name?: string | null } | null | undefined;
    /** Optional contact sub-identifier (already access-gated by the caller). */
    subId?: string | null;
    className?: string;
    /** Set a `title` attribute (for truncated names). */
    title?: boolean;
}

export function AdopterName({ adopter, subId, className, title }: AdopterNameProps) {
    const { t } = useLanguage();
    if (isNamelessAdopter(adopter)) {
        return (
            <span className={className} title={title ? t('adopter.nameless') : undefined}>
                <span className="italic" style={{ color: 'var(--text-muted)' }}>{t('adopter.nameless')}</span>
                {subId ? <span className="ml-1 font-normal not-italic" style={{ color: 'var(--text-muted)' }}>· {subId}</span> : null}
            </span>
        );
    }
    const name = adopter!.name as string;
    return <span className={className} title={title ? name : undefined}>{name}</span>;
}
