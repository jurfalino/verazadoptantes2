'use client';

import { useEffect, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';

interface Info {
    handle: string | null;
    orgs: { name: string; slug: string }[];
    contractBase?: string;
}

interface PublicConfig {
    SHOWCASE_GLOBAL_VISIBLE?: string;
    SHOWCASE_ORG_VISIBLE?: string;
    SHOWCASE_USER_VISIBLE?: string;
}

/**
 * Dropdown-menu button rendered in the /my-animals page header next to
 * ShareFormMenu. Opens a modal listing the user's public-showcase URLs,
 * each with a Copy and an Open-in-new-tab action.
 *
 * Each scope is gated by its own admin feature flag:
 *   SHOWCASE_GLOBAL_VISIBLE → "Todos los animales" (/)
 *   SHOWCASE_USER_VISIBLE   → "Mis animales" (/user/[handle])
 *   SHOWCASE_ORG_VISIBLE    → one row per org (/org/[slug])
 *
 * Renders nothing when all three flags are off or the user has nothing
 * shareable. The contract-app base URL comes from /api/my-showcase-info
 * (server-side runtime env, so staging and prod resolve correctly).
 */
export default function ShowcaseUrlChips() {
    const { t } = useLanguage();
    const toast = useShowToast();
    const [info, setInfo] = useState<Info | null>(null);
    const [flags, setFlags] = useState<PublicConfig>({});
    const [loaded, setLoaded] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const [copiedKey, setCopiedKey] = useState<string | null>(null);

    useEffect(() => {
        async function load() {
            try {
                const [infoRes, cfgRes] = await Promise.all([
                    fetch('/api/my-showcase-info'),
                    fetch('/api/config'),
                ]);
                if (infoRes.ok) setInfo(await infoRes.json() as Info);
                if (cfgRes.ok) {
                    const cfg = await cfgRes.json() as { config?: PublicConfig };
                    setFlags(cfg.config || {});
                }
            } catch { /* silent — section just doesn't render */ }
            finally { setLoaded(true); }
        }
        load();
    }, []);

    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setIsOpen(false);
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen]);

    const globalOn = flags.SHOWCASE_GLOBAL_VISIBLE === 'true';
    const orgOn = flags.SHOWCASE_ORG_VISIBLE === 'true';
    const userOn = flags.SHOWCASE_USER_VISIBLE === 'true';
    const contractBase = (info?.contractBase || '').replace(/\/+$/, '');

    const links: { id: string; label: string; sublabel: string; url: string }[] = [];
    if (globalOn && contractBase) {
        links.push({
            id: 'all',
            label: t('myAnimals.showcase_global'),
            sublabel: t('myAnimals.showcase_global_desc'),
            url: `${contractBase}/`,
        });
    }
    if (userOn && info?.handle && contractBase) {
        links.push({
            id: 'user',
            label: t('myAnimals.showcase_user'),
            sublabel: t('myAnimals.showcase_user_desc'),
            url: `${contractBase}/user/${info.handle}`,
        });
    }
    if (orgOn && info?.orgs && contractBase) {
        for (const org of info.orgs) {
            links.push({
                id: `org-${org.slug}`,
                label: org.name,
                sublabel: t('myAnimals.showcase_org_desc'),
                url: `${contractBase}/org/${org.slug}`,
            });
        }
    }

    if (!loaded || links.length === 0) return null;

    const handleCopy = async (key: string, url: string) => {
        try {
            await navigator.clipboard.writeText(url);
            setCopiedKey(key);
            setTimeout(() => setCopiedKey(prev => (prev === key ? null : prev)), 1500);
            toast.success(t('myAnimals.showcase_copied'), '');
        } catch {
            toast.error(t('errors.generic'), t('myAnimals.showcase_copy_failed'));
        }
    };

    return (
        <>
            <button
                onClick={(e) => { e.stopPropagation(); e.preventDefault(); setIsOpen(true); }}
                className="inline-flex items-center gap-2 px-4 py-2.5 text-[13px] font-semibold text-indigo-700 bg-indigo-50 rounded-xl hover:bg-indigo-100 transition-colors border border-indigo-200"
                aria-label={t('myAnimals.showcase_menu_label')}
            >
                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 015.656 0l1.415 1.415a4 4 0 01-5.657 5.656l-1.414-1.414M10.172 13.828a4 4 0 01-5.656 0l-1.415-1.415a4 4 0 015.657-5.656l1.414 1.414" />
                </svg>
                {t('myAnimals.showcase_menu_label')}
            </button>

            {isOpen && (
                <div
                    className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200"
                    onClick={() => setIsOpen(false)}
                >
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
                    <div
                        className="relative bg-white rounded-2xl shadow-2xl border border-stone-200 w-full max-w-md animate-in zoom-in-95 slide-in-from-bottom-4 duration-300"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="p-5 pb-3 border-b border-stone-100">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center text-indigo-700">
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 015.656 0l1.415 1.415a4 4 0 01-5.657 5.656l-1.414-1.414M10.172 13.828a4 4 0 01-5.656 0l-1.415-1.415a4 4 0 015.657-5.656l1.414 1.414" />
                                        </svg>
                                    </div>
                                    <div>
                                        <h3 className="font-semibold text-stone-900 text-sm">{t('myAnimals.showcase_section_title')}</h3>
                                        <p className="text-xs text-stone-500 mt-0.5">{t('myAnimals.showcase_section_desc')}</p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setIsOpen(false)}
                                    className="w-8 h-8 rounded-full flex items-center justify-center text-stone-500 hover:bg-stone-100 hover:text-stone-600 transition-colors"
                                    aria-label={t('common.close') || 'Close'}
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                </button>
                            </div>
                        </div>

                        <div className="p-3 space-y-1 max-h-[60vh] overflow-y-auto">
                            {links.map((link) => (
                                <div
                                    key={link.id}
                                    className="flex items-start gap-3 px-3 py-3 rounded-xl hover:bg-stone-50 transition-colors"
                                >
                                    <div className="w-10 h-10 rounded-xl bg-stone-100 flex items-center justify-center flex-shrink-0 text-stone-600">
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 015.656 0l1.415 1.415a4 4 0 01-5.657 5.656l-1.414-1.414M10.172 13.828a4 4 0 01-5.656 0l-1.415-1.415a4 4 0 015.657-5.656l1.414 1.414" />
                                        </svg>
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-semibold text-stone-900 truncate">{link.label}</p>
                                        <p className="text-xs text-stone-500 mb-1.5">{link.sublabel}</p>
                                        <code className="block text-[11px] text-stone-500 truncate" title={link.url}>{link.url}</code>
                                        <div className="flex items-center gap-2 mt-2">
                                            <button
                                                type="button"
                                                onClick={() => handleCopy(link.id, link.url)}
                                                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 rounded-md transition-colors"
                                            >
                                                {copiedKey === link.id ? '✅' : (
                                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                                    </svg>
                                                )}
                                                {copiedKey === link.id ? t('myAnimals.showcase_copied') : t('myAnimals.showcase_copy')}
                                            </button>
                                            <a
                                                href={link.url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-md transition-colors"
                                            >
                                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                                </svg>
                                                {t('myAnimals.showcase_open')}
                                            </a>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
