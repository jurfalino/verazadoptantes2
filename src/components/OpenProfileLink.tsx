'use client';

/**
 * «Abrir perfil ↗» — opening a profile in a NEW tab, one look on every
 * surface and for every role (Jon, 2026-11-01, point B): an accent text link
 * with the drawn arrow (an SVG, never a typed «↗»), 44px tall. «Ver perfil» is
 * only the window that opens over the page («¿Es este perfil?»).
 *
 * `href`: a plain link to the new tab. `onClick`: a button, for a caller that
 * must do something first (the dup-hint writes the search-match grant, then
 * opens the tab itself).
 */
import { ArrowUpRight } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';

const CLS = 'inline-flex items-center gap-1 min-h-[44px] px-1 rounded-xl text-[14px] font-semibold hover:underline underline-offset-2 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]';

export function OpenProfileLink({ href, onClick, disabled = false, testId, className = '' }: {
    href?: string;
    onClick?: () => void;
    disabled?: boolean;
    testId?: string;
    className?: string;
}) {
    const { t } = useLanguage();
    const body = (
        <>
            {t('adopter.open_profile')}
            <ArrowUpRight className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span className="sr-only">{t('common.opens_new_tab')}</span>
        </>
    );
    if (href) {
        return <a href={href} target="_blank" rel="noopener noreferrer" data-testid={testId} className={`${CLS} ${className}`} style={{ color: 'var(--accent)' }}>{body}</a>;
    }
    return <button type="button" onClick={onClick} disabled={disabled} data-testid={testId} className={`${CLS} ${className}`} style={{ color: 'var(--accent)' }}>{body}</button>;
}
