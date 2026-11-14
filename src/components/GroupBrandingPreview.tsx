'use client';

import type { CSSProperties } from 'react';
import { ACCENTS, type AccentId, type GroupTheme } from '@/domain/groupBranding';

/**
 * A small copy of the PUBLIC group header (contract-app BrandHeader + brand.css)
 * in the group's chosen theme and accent, for the «Personalizar» section of a
 * group card. The dashboard cannot import contract-app, so the public look is
 * re-created here (at most a 390px phone wide): colours from contract-app/src/petshield.css (`:root` = dark,
 * `[data-ps-theme="light"]` = light), layout from brand.css at phone width.
 *
 * Every colour comes from inline CSS variables, never from the dashboard's
 * themed Tailwind classes (`.bg-white`, `text-stone-*` are remapped per
 * [data-theme]), so the preview looks the same in the dashboard's light and
 * dark modes — it shows what an adopter sees, not the dashboard.
 */

/** Public-page surface tokens (petshield.css) per group theme. */
export const PUBLIC_THEME_TOKENS: Record<GroupTheme, { bg: string; card: string; text: string; secondary: string; muted: string; border: string; onAccent: string }> = {
    dark: { bg: '#0f172a', card: '#1e293b', text: '#f1f5f9', secondary: '#94a3b8', muted: '#64748b', border: 'rgba(148, 163, 184, 0.12)', onAccent: '#0f172a' },
    light: { bg: '#f8fafc', card: '#ffffff', text: '#0f172a', secondary: '#475569', muted: '#64748b', border: 'rgba(15, 23, 42, 0.12)', onAccent: '#ffffff' },
};

/** The accent shade the public pages use for this theme (dark → `d`, light → `l`). */
export function accentShade(accentId: AccentId, theme: GroupTheme): string {
    const a = ACCENTS.find(x => x.id === accentId) ?? ACCENTS[0];
    return theme === 'light' ? a.l : a.d;
}

/** Group images live in the public R2 bucket; locally only the proxy can read them (as AdopterForm does). */
export function brandingImageSrc(url: string): string {
    return url.includes('r2.dev') ? `/api/proxy-image?url=${encodeURIComponent(url)}` : url;
}

type IconProps = { className?: string };

export function InstagramIcon({ className }: IconProps) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
        </svg>
    );
}

export function FacebookIcon({ className }: IconProps) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 3h-2.5A4.5 4.5 0 0 0 8 7.5V10H5.5v4H8v7h4v-7h3l1-4h-4V7.5c0-.6.4-1 1-1h2V3z" />
        </svg>
    );
}

export function WebIcon({ className }: IconProps) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
        </svg>
    );
}

export type PreviewLink = { key: string; label: string; Icon: (p: IconProps) => React.JSX.Element };

export default function GroupBrandingPreview({
    orgName, theme, accentId, logoUrl, bannerUrl, links, countText, buttonText, ariaLabel,
}: {
    orgName: string; theme: GroupTheme; accentId: AccentId;
    logoUrl: string | null; bannerUrl: string | null;
    /** Only the links that are filled in, in the public order (Instagram, Facebook, website). */
    links: PreviewLink[];
    countText: string; buttonText: string; ariaLabel: string;
}) {
    const tk = PUBLIC_THEME_TOKENS[theme];
    const vars = {
        '--pv-bg': tk.bg, '--pv-card': tk.card, '--pv-text': tk.text, '--pv-muted': tk.muted,
        '--pv-border': tk.border, '--pv-tile': '#ffffff', '--pv-accent': accentShade(accentId, theme), '--pv-on-accent': tk.onAccent,
    } as CSSProperties;
    const hasBanner = !!bannerUrl;

    return (
        <div
            role="img"
            aria-label={ariaLabel}
            data-testid="group-branding-preview"
            data-preview-theme={theme}
            style={vars}
            className="w-full max-w-[390px] rounded-2xl overflow-hidden border border-stone-200 bg-[color:var(--pv-bg)] text-[color:var(--pv-text)]"
        >
            {hasBanner && (
                <div className="aspect-[3/1] overflow-hidden bg-[color:var(--pv-card)]">
                    <img src={brandingImageSrc(bannerUrl)} alt="" className="block w-full h-full object-cover" />
                </div>
            )}
            <div className={`px-6 pb-6 ${hasBanner ? '' : 'pt-6'}`}>
                {/* .pb-header: identity, links, then a hairline */}
                <div className="pb-6 border-b border-[color:var(--pv-border)]">
                    <div className={`flex gap-4 mb-4 ${hasBanner ? '-mt-9 items-start px-2' : 'items-center'}`}>
                        {logoUrl && (
                            // Own white tile (border in the page colour), so transparent logos read on both themes.
                            <img
                                src={brandingImageSrc(logoUrl)}
                                alt=""
                                className="w-[72px] h-[72px] shrink-0 rounded-full object-cover bg-[color:var(--pv-tile)] border-[3px] border-[color:var(--pv-bg)] shadow-[0_2px_8px_rgba(15,23,42,0.25)]"
                            />
                        )}
                        <div className={`min-w-0 ${hasBanner && logoUrl ? 'pt-11' : ''}`}>
                            <p className={`m-0 font-bold leading-tight [overflow-wrap:anywhere] ${hasBanner ? 'text-xl' : 'text-[28px]'}`}>{orgName}</p>
                            <p className="mt-2 mb-0 text-[13px] font-semibold uppercase tracking-[0.04em] text-[color:var(--pv-muted)]">{countText}</p>
                        </div>
                    </div>
                    {links.length > 0 && (
                        <div className="grid grid-cols-3 gap-2">
                            {links.map(({ key, label, Icon }) => (
                                <span
                                    key={key}
                                    className="inline-flex items-center justify-center gap-1.5 min-h-11 min-w-0 px-2.5 rounded-xl border border-[color:var(--pv-border)] bg-[color:var(--pv-card)] text-[13px] font-semibold whitespace-nowrap"
                                >
                                    <Icon className="w-4 h-4 shrink-0 text-[color:var(--pv-accent)]" />
                                    <span className="overflow-hidden text-ellipsis">{label}</span>
                                </span>
                            ))}
                        </div>
                    )}
                </div>
                <span className="mt-6 flex items-center justify-center min-h-11 rounded-xl text-sm font-bold bg-[color:var(--pv-accent)] text-[color:var(--pv-on-accent)]">
                    {buttonText}
                </span>
            </div>
        </div>
    );
}
