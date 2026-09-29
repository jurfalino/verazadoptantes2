'use client';

/**
 * /settings/adoption-docs[?org=<id>] — edit the adoption form (which
 * questions are asked) and contract sections 2–4 for the caller ("Los míos")
 * or for one of their groups. Protected by middleware (/settings prefix).
 * Renders nothing new unless ENABLE_CUSTOM_ADOPTION_DOCS is on.
 *
 * The only route that loads TipTap (via ContractSectionsEditor).
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useDateFormat } from '@/context/TimezoneContext';
import { useShowToast } from '@/components/ui/Toast';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { fetchCustomAdoptionDocsFlag } from '@/lib/adoptionDocsFlag';
import {
    getAdoptionDocs, saveFormSteps, saveContractSections, type OwnerRef,
} from '@/app/actions/adoptionDocs';
import { SECTION_KEYS, canonicalSectionsJson, type ContractSections, type SectionKey } from '@/domain/adoptionDocs';
import { sectionsToSave, isDocsDraftDirty } from '@/domain/standardContractText';
import FormStepsEditor from '@/components/adoptionDocs/FormStepsEditor';
import ContractSectionsEditor from '@/components/adoptionDocs/ContractSectionsEditor';

type Tab = 'form' | 'contract';
type Meta = { ownerName: string; updatedAt: number | null; updatedByName: string | null };
type Status = 'loading' | 'off' | 'forbidden' | 'error' | 'ready';

const SOURCE = 'AdoptionDocsEditor';

const btnPrimary = 'min-h-11 py-3 px-6 rounded-xl text-sm font-bold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors';
const btnSecondary = 'min-h-11 py-3 px-6 rounded-xl text-sm font-bold text-teal-700 bg-teal-50 border border-teal-200 hover:bg-teal-100 hover:border-teal-400 disabled:opacity-40 transition-colors';

function BackLink() {
    const { t } = useLanguage();
    return (
        <Link href="/settings#adoption-docs" className="inline-flex items-center gap-2 min-h-11 text-sm text-teal-700 hover:text-teal-800 transition-colors font-medium group">
            <svg className="w-4 h-4 group-hover:-translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
            {t('adoptionDocs.back_to_settings')}
        </Link>
    );
}

function Notice({ text }: { text: string }) {
    return (
        <div className="rounded-2xl border border-stone-200 bg-white p-6 text-sm text-stone-700" data-testid="adoption-docs-notice">
            {text}
        </div>
    );
}

function AdoptionDocsEditor() {
    const { t } = useLanguage();
    const toast = useShowToast();
    const { formatDateTime } = useDateFormat();
    const searchParams = useSearchParams();
    const orgId = searchParams.get('org');
    const owner: OwnerRef = useMemo(() => (orgId ? { type: 'org', orgId } : { type: 'self' }), [orgId]);

    const [status, setStatus] = useState<Status>('loading');
    const [meta, setMeta] = useState<Meta | null>(null);
    const [hidden, setHidden] = useState<string[]>([]);
    const [sections, setSections] = useState<ContractSections>({});
    // Last-saved state of each tab — the baseline for the unsaved-changes guard.
    const [savedHidden, setSavedHidden] = useState<string[]>([]);
    const [savedSections, setSavedSections] = useState<ContractSections>({});
    const [tab, setTab] = useState<Tab>('form');
    const [saving, setSaving] = useState(false);
    // Per-section remount counters, bumped after a save changes what an editor shows.
    const [remounts, setRemounts] = useState<Partial<Record<SectionKey, number>>>({});

    // Tab lives in the hash (#contrato) so a reload or shared link keeps it.
    useEffect(() => {
        if (window.location.hash === '#contrato') setTab('contract');
    }, []);
    const selectTab = (next: Tab) => {
        setTab(next);
        const url = `${window.location.pathname}${window.location.search}${next === 'contract' ? '#contrato' : ''}`;
        window.history.replaceState(window.history.state, '', url);
    };

    const failToast = useCallback((errorId: string) => {
        toast.error(t('errors.generic'), t('adoptionDocs.save_failed'), errorId);
    }, [toast, t]);

    // `t` changes identity once the stored locale hydrates; reading it through
    // a ref keeps that from re-running the initial load and wiping the drafts.
    const tRef = useRef(t);
    useEffect(() => { tRef.current = t; });

    /**
     * Fetch the owner's docs. `full` (first load) checks the flag and resets
     * the drafts; otherwise it only refreshes "Última edición" after a save —
     * a failure there is reported but not toasted, since the save succeeded.
     */
    const load = useCallback(async (full: boolean) => {
        const tt = tRef.current;
        try {
            if (full) {
                const on = await fetchCustomAdoptionDocsFlag();
                if (!on) { setStatus('off'); return; }
            }
            const res = await getAdoptionDocs(owner);
            if (!res?.success || !res.data) {
                if (!full) { resolveErrorId(res, `${SOURCE}.refresh`); return; }
                if (res?.error === 'forbidden') { setStatus('forbidden'); return; }
                if (res?.error === 'disabled') { setStatus('off'); return; }
                setStatus('error');
                toast.error(tt('errors.generic'), tt('errors.unexpected'), res?.errorId || resolveErrorId(res, SOURCE));
                return;
            }
            const d = res.data;
            setMeta({ ownerName: d.ownerName, updatedAt: d.updatedAt, updatedByName: d.updatedByName });
            if (full) {
                setHidden(d.hiddenSteps);
                setSections(d.sections);
                setSavedHidden(d.hiddenSteps);
                setSavedSections(d.sections);
                setStatus('ready');
            }
        } catch (error) {
            if (!full) { resolveErrorId(error, `${SOURCE}.refresh`); return; }
            setStatus('error');
            toast.error(tt('errors.generic'), tt('errors.unexpected'), resolveErrorId(error, SOURCE));
        }
    }, [owner, toast]);

    useEffect(() => { void load(true); }, [load]);

    // Unsaved changes in either tab → the browser asks before a reload,
    // tab close or off-site navigation throws them away.
    const dirty = useMemo(() => {
        const d = isDocsDraftDirty({ savedHidden, hidden, savedSections, sections });
        return d.form || d.contract;
    }, [savedHidden, hidden, savedSections, sections]);
    useEffect(() => {
        if (!dirty) return;
        const onBeforeUnload = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            e.returnValue = ''; // required by Chrome/Safari to show the prompt
        };
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, [dirty]);

    /** Toasts the outcome; true when the save succeeded. */
    const handleResult = async (res: { success: boolean; error?: string; errorId?: string } | undefined): Promise<boolean> => {
        if (res?.success) {
            toast.success(t('settings.saved'));
            await load(false); // refresh "Última edición"
            return true;
        }
        const errorId = res?.errorId || resolveErrorId(res, SOURCE);
        if (res?.error === 'disabled') toast.error(t('errors.generic'), t('adoptionDocs.disabled'), errorId);
        else if (res?.error === 'forbidden') toast.error(t('errors.generic'), t('adoptionDocs.forbidden'), errorId);
        else if (res?.error === 'invalid') toast.error(t('errors.generic'), t('adoptionDocs.too_long'), errorId);
        else failToast(errorId);
        return false;
    };

    const saveForm = async () => {
        setSaving(true);
        try {
            const saved = hidden;
            if (await handleResult(await saveFormSteps(owner, saved))) setSavedHidden(saved);
        } catch (error) {
            failToast(resolveErrorId(error, SOURCE));
        } finally {
            setSaving(false);
        }
    };

    const saveContract = async () => {
        setSaving(true);
        try {
            const toSave = sectionsToSave(sections);
            if (await handleResult(await saveContractSections(owner, toSave))) {
                // Show exactly what was saved: a section equal to the standard
                // text, or emptied, was sent as absent and now reads as the
                // standard text again; a kept one is shown normalized. Remount
                // only the editors whose content changed.
                const changed = SECTION_KEYS.filter(k =>
                    canonicalSectionsJson(sections[k] ? { [k]: sections[k] } : {}) !== canonicalSectionsJson(toSave[k] ? { [k]: toSave[k] } : {}));
                setSections(toSave);
                setSavedSections(toSave);
                if (changed.length) {
                    setRemounts(r => {
                        const next = { ...r };
                        for (const k of changed) next[k] = (next[k] ?? 0) + 1;
                        return next;
                    });
                }
            }
        } catch (error) {
            failToast(resolveErrorId(error, SOURCE));
        } finally {
            setSaving(false);
        }
    };

    if (status === 'loading') {
        return (
            <div className="animate-pulse space-y-4" aria-busy="true">
                <div className="h-8 bg-stone-200 rounded w-2/3" />
                <div className="h-12 bg-stone-200 rounded-xl" />
                <div className="h-64 bg-stone-200 rounded-2xl" />
            </div>
        );
    }
    if (status === 'off') return <Notice text={t('adoptionDocs.disabled')} />;
    if (status === 'forbidden') return <Notice text={t('adoptionDocs.forbidden')} />;
    if (status === 'error' || !meta) return <Notice text={t('adoptionDocs.load_failed')} />;

    const name = owner.type === 'self' ? t('adoptionDocs.mine') : meta.ownerName;
    const tabClass = (active: boolean) => `flex-1 min-h-11 px-4 rounded-lg text-sm font-semibold transition-colors ${active
        ? 'bg-stone-800 text-white shadow-sm'
        : 'text-stone-500 hover:text-stone-700 hover:bg-stone-100'}`;

    return (
        <div className="space-y-6">
            <header>
                <h1 className="text-xl font-bold tracking-tight text-stone-900" data-testid="adoption-docs-title">
                    {t('adoptionDocs.editing').replace('{name}', name)}
                </h1>
                {meta.updatedAt && meta.updatedByName && (
                    <p className="text-sm text-stone-500 mt-2" data-testid="adoption-docs-last-edited">
                        {t('adoptionDocs.last_edited')
                            .replace('{name}', meta.updatedByName)
                            .replace('{date}', formatDateTime(meta.updatedAt))}
                    </p>
                )}
            </header>

            <div role="tablist" className="flex gap-1 bg-white p-1 rounded-xl border border-stone-200">
                <button type="button" role="tab" id="tab-form" aria-controls="panel-form" aria-selected={tab === 'form'} onClick={() => selectTab('form')} className={tabClass(tab === 'form')}>
                    {t('adoptionDocs.tab_form')}
                </button>
                <button type="button" role="tab" id="tab-contract" aria-controls="panel-contract" aria-selected={tab === 'contract'} onClick={() => selectTab('contract')} className={tabClass(tab === 'contract')}>
                    {t('adoptionDocs.tab_contract')}
                </button>
            </div>

            {tab === 'form' ? (
                <div role="tabpanel" id="panel-form" aria-labelledby="tab-form" className="space-y-6">
                    <FormStepsEditor hidden={hidden} onChange={setHidden} />
                    <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={saveForm} disabled={saving} className={btnPrimary} data-testid="adoption-docs-save-form">
                            {saving ? t('animalProfile.saving') : t('common.save')}
                        </button>
                        <button type="button" onClick={() => setHidden([])} disabled={saving || hidden.length === 0} className={btnSecondary}>
                            {t('adoptionDocs.restore_defaults')}
                        </button>
                    </div>
                </div>
            ) : (
                <div role="tabpanel" id="panel-contract" aria-labelledby="tab-contract" className="space-y-6">
                    <ContractSectionsEditor sections={sections} onChange={setSections} remounts={remounts} />
                    <div className="space-y-2">
                        <button type="button" onClick={saveContract} disabled={saving} className={btnPrimary} data-testid="adoption-docs-save-contract">
                            {saving ? t('animalProfile.saving') : t('common.save')}
                        </button>
                        <p className="text-xs text-stone-500 max-w-prose">{t('adoptionDocs.disclaimer')}</p>
                    </div>
                </div>
            )}
        </div>
    );
}

export default function AdoptionDocsPage() {
    return (
        <main className="flex-1 container mx-auto px-4 py-8 max-w-2xl">
            <div className="mb-4"><BackLink /></div>
            <Suspense fallback={<div className="h-64 bg-stone-200 rounded-2xl animate-pulse" />}>
                <AdoptionDocsEditor />
            </Suspense>
        </main>
    );
}
