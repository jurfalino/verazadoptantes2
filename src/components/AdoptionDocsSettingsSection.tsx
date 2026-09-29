'use client';

/**
 * «Formulario y contrato de adopción» card in /settings: which owner's form
 * and contract the caller's shared links use (theirs or one of their groups'),
 * plus links to the editor. Renders only when the public
 * ENABLE_CUSTOM_ADOPTION_DOCS flag is on.
 *
 * Keep this file free of '@/domain/adoptionDocs' and the editor components:
 * the first builds zod schemas at module scope and the second pulls TipTap,
 * neither of which belongs in the /settings bundle.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { fetchCustomAdoptionDocsFlag } from '@/lib/adoptionDocsFlag';
import { getAdoptionDocsOverview, setAdoptionDocsSource, type DocsSummary } from '@/app/actions/adoptionDocs';

type Overview = { source: string; self: DocsSummary; orgs: Array<{ id: string; name: string } & DocsSummary> };

const SOURCE = 'AdoptionDocsSettingsSection';
const btnCompact = 'inline-flex items-center max-w-full break-words min-h-11 py-2 px-4 rounded-xl text-sm font-bold text-teal-700 bg-teal-50 border border-teal-200 hover:bg-teal-100 hover:border-teal-400 transition-colors';

function Pill({ customized }: { customized: boolean }) {
    const { t } = useLanguage();
    return (
        <span className={`shrink-0 px-2 py-1 rounded-full leading-none text-[11px] font-semibold border ${customized
            ? 'bg-teal-50 text-teal-700 border-teal-200'
            : 'bg-stone-100 text-stone-500 border-stone-200'}`}>
            {customized ? t('adoptionDocs.pill_custom') : t('adoptionDocs.pill_standard')}
        </span>
    );
}

export default function AdoptionDocsSettingsSection() {
    const { t } = useLanguage();
    const toast = useShowToast();
    const [overview, setOverview] = useState<Overview | null>(null);
    const [source, setSource] = useState('self');
    const [switching, setSwitching] = useState(false);
    const tRef = useRef(t);
    useEffect(() => { tRef.current = t; });

    useEffect(() => {
        let cancelled = false;
        async function load() {
            let on = false;
            try {
                on = await fetchCustomAdoptionDocsFlag();
            } catch (error) {
                // Flag unreadable → the card stays hidden (the default), but say so.
                resolveErrorId(error, `${SOURCE}.flag`);
                return;
            }
            if (!on || cancelled) return;
            try {
                const res = await getAdoptionDocsOverview();
                if (cancelled) return;
                if (res?.success && res.data) {
                    setOverview(res.data);
                    setSource(res.data.source);
                } else if (res?.error !== 'disabled') {
                    toast.error(tRef.current('errors.generic'), tRef.current('errors.unexpected'), res?.errorId || resolveErrorId(res, SOURCE));
                }
            } catch (error) {
                if (!cancelled) toast.error(tRef.current('errors.generic'), tRef.current('errors.unexpected'), resolveErrorId(error, SOURCE));
            }
        }
        void load();
        return () => { cancelled = true; };
    }, [toast]);

    if (!overview) return null;

    const choose = async (next: string) => {
        if (next === source || switching) return;
        const previous = source;
        setSource(next);
        setSwitching(true);
        try {
            const res = await setAdoptionDocsSource(next);
            if (res?.success) {
                toast.success(t('settings.saved'));
                return;
            }
            setSource(previous);
            if (res?.error === 'disabled') toast.error(t('errors.generic'), t('adoptionDocs.disabled'), res.errorId || resolveErrorId(res, SOURCE));
            else if (res?.error === 'forbidden') toast.error(t('errors.generic'), t('adoptionDocs.forbidden'), res.errorId || resolveErrorId(res, SOURCE));
            else toast.error(t('errors.generic'), t('adoptionDocs.save_failed'), res?.errorId || resolveErrorId(res, SOURCE));
        } catch (error) {
            setSource(previous);
            toast.error(t('errors.generic'), t('adoptionDocs.save_failed'), resolveErrorId(error, SOURCE));
        } finally {
            setSwitching(false);
        }
    };

    const options = [
        { value: 'self', label: t('adoptionDocs.use_mine'), customized: overview.self.customized },
        ...overview.orgs.map(o => ({
            value: `org:${o.id}`,
            label: t('adoptionDocs.use_group').replace('{name}', o.name),
            customized: o.customized,
        })),
    ];

    return (
        <section id="adoption-docs" className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6 scroll-mt-20" data-testid="adoption-docs-settings">
            <h2 className="text-base font-bold text-stone-900">{t('adoptionDocs.settings_title')}</h2>
            <p className="text-sm text-stone-500 mt-2 mb-4 max-w-prose">{t('adoptionDocs.settings_hint')}</p>

            {overview.orgs.length > 0 ? (
                <fieldset disabled={switching}>
                    <legend className="text-xs font-semibold uppercase tracking-wide text-stone-500 mb-2">{t('adoptionDocs.use_label')}</legend>
                    <div>
                        {options.map(o => (
                            <label key={o.value} className="flex items-center gap-4 min-h-11 px-2 rounded-xl cursor-pointer hover:bg-stone-50 transition-colors">
                                <input
                                    type="radio"
                                    name="adoption-docs-source"
                                    value={o.value}
                                    checked={source === o.value}
                                    onChange={() => choose(o.value)}
                                    className="w-4 h-4 accent-teal-600"
                                />
                                <span className="flex-1 min-w-0 text-sm font-medium text-stone-800 break-words">{o.label}</span>
                                <Pill customized={o.customized} />
                            </label>
                        ))}
                    </div>
                </fieldset>
            ) : (
                <div className="flex items-center gap-4 min-h-11">
                    <span className="flex-1 text-sm font-medium text-stone-800">{t('adoptionDocs.use_mine')}</span>
                    <Pill customized={overview.self.customized} />
                </div>
            )}

            <div className="flex flex-wrap gap-2 mt-4">
                <Link href="/settings/adoption-docs" className={btnCompact} data-testid="adoption-docs-edit-mine">
                    {t('adoptionDocs.edit_mine')}
                </Link>
                {overview.orgs.map(o => (
                    <Link key={o.id} href={`/settings/adoption-docs?org=${encodeURIComponent(o.id)}`} className={btnCompact}>
                        {t('adoptionDocs.edit_group').replace('{name}', o.name)}
                    </Link>
                ))}
            </div>
        </section>
    );
}
