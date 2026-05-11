'use client';

import { useEffect, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';

interface Props {
    /** Vite-app base URL — defaults to the env var, can be overridden in tests. */
    contractBase?: string;
}

interface Info {
    handle: string | null;
    orgs: { name: string; slug: string }[];
}

interface PublicConfig {
    SHOWCASE_GLOBAL_VISIBLE?: string;
    SHOWCASE_ORG_VISIBLE?: string;
    SHOWCASE_USER_VISIBLE?: string;
}

const DEFAULT_BASE = (process.env.NEXT_PUBLIC_CONTRACT_URL || 'https://adoptions.pages.dev').replace(/\/+$/, '');

/**
 * /my-animals header section — "Tu showcase público". Renders one copy-to-
 * clipboard chip per scope, each gated by its own admin feature flag:
 *   SHOWCASE_GLOBAL_VISIBLE → "Todos los animales en adopción" (/)
 *   SHOWCASE_USER_VISIBLE   → "Mis animales" (/user/[handle])
 *   SHOWCASE_ORG_VISIBLE    → one chip per org (/org/[slug])
 *
 * If all three flags are off, or the user has neither handle nor org
 * memberships and the global flag is off, the section renders nothing.
 */
export default function ShowcaseUrlChips({ contractBase = DEFAULT_BASE }: Props) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const [info, setInfo] = useState<Info | null>(null);
    const [flags, setFlags] = useState<PublicConfig>({});
    const [loaded, setLoaded] = useState(false);

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

    const globalOn = flags.SHOWCASE_GLOBAL_VISIBLE === 'true';
    const orgOn = flags.SHOWCASE_ORG_VISIBLE === 'true';
    const userOn = flags.SHOWCASE_USER_VISIBLE === 'true';

    const chips: { id: string; label: string; url: string }[] = [];
    if (globalOn) {
        chips.push({ id: 'all', label: t('myAnimals.showcase_global'), url: `${contractBase}/` });
    }
    if (userOn && info?.handle) {
        chips.push({ id: 'user', label: t('myAnimals.showcase_user'), url: `${contractBase}/user/${info.handle}` });
    }
    if (orgOn && info?.orgs) {
        for (const org of info.orgs) {
            chips.push({ id: `org-${org.slug}`, label: org.name, url: `${contractBase}/org/${org.slug}` });
        }
    }

    if (!loaded || chips.length === 0) return null;

    const handleCopy = async (url: string) => {
        try {
            await navigator.clipboard.writeText(url);
            toast.success(t('myAnimals.showcase_copied'), '');
        } catch {
            toast.error(t('errors.generic'), t('myAnimals.showcase_copy_failed'));
        }
    };

    return (
        <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-4 md:p-5 mb-4">
            <h3 className="text-sm font-semibold text-stone-900 mb-1">{t('myAnimals.showcase_section_title')}</h3>
            <p className="text-xs text-stone-500 mb-3">{t('myAnimals.showcase_section_desc')}</p>
            <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2">
                {chips.map((chip) => (
                    <div key={chip.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-stone-50 border border-stone-200">
                        <span className="text-xs font-semibold text-stone-700 whitespace-nowrap">{chip.label}</span>
                        <code className="text-xs text-stone-500 truncate min-w-0 flex-1" title={chip.url}>{chip.url}</code>
                        <button
                            type="button"
                            onClick={() => handleCopy(chip.url)}
                            className="px-2 py-1 text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 rounded transition-colors whitespace-nowrap"
                            aria-label={t('myAnimals.showcase_copy')}
                        >
                            {t('myAnimals.showcase_copy')}
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}
