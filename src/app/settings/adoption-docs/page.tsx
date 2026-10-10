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
    getAdoptionDocs, saveFormSteps, saveContractSections,
    type OwnerRef, type ItemRevisions, type SectionConflict, type StepConflict,
} from '@/app/actions/adoptionDocs';
import { SECTION_KEYS, TOGGLEABLE_FORM_STEPS, type ContractSections, type SectionKey } from '@/domain/adoptionDocs';
import { isDocsDraftDirty } from '@/domain/standardContractText';
import { sectionRevisionText, storedSection, stepStates } from '@/domain/adoptionDocsCollab';
import FormStepsEditor from '@/components/adoptionDocs/FormStepsEditor';
import ContractSectionsEditor from '@/components/adoptionDocs/ContractSectionsEditor';

type Tab = 'form' | 'contract';
type Meta = { ownerName: string; updatedAt: number | null; updatedByName: string | null };
type Status = 'loading' | 'off' | 'forbidden' | 'error' | 'ready';

const SOURCE = 'AdoptionDocsEditor';

/** «otra persona del grupo» can open a sentence. */
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

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
    // Collaborative editing: the revision each item was loaded at, items a
    // teammate saved meanwhile (conflicts) and items pulled in from them.
    const [revs, setRevs] = useState<ItemRevisions | null>(null);
    const [conflicts, setConflicts] = useState<Partial<Record<SectionKey, SectionConflict>>>({});
    const [updatedBy, setUpdatedBy] = useState<Partial<Record<SectionKey, string>>>({});
    const [stepConflicts, setStepConflicts] = useState<Record<string, StepConflict>>({});
    const [stepUpdatedBy, setStepUpdatedBy] = useState<Record<string, string>>({});

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
                setRevs(d.revisions);
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

    /** The failure toast for a refused / failed save. */
    const failResult = (res: { error?: string; errorId?: string } | undefined) => {
        const errorId = res?.errorId || resolveErrorId(res, SOURCE);
        if (res?.error === 'disabled') toast.error(t('errors.generic'), t('adoptionDocs.disabled'), errorId);
        else if (res?.error === 'forbidden') toast.error(t('errors.generic'), t('adoptionDocs.forbidden'), errorId);
        else if (res?.error === 'invalid') toast.error(t('errors.generic'), t('adoptionDocs.too_long'), errorId);
        else if (res?.error === 'busy') toast.error(t('errors.generic'), t('adoptionDocs.busy'), errorId);
        else failToast(errorId);
    };

    const bump = (keys: SectionKey[]) => {
        if (!keys.length) return;
        setRemounts(r => {
            const next = { ...r };
            for (const k of keys) next[k] = (next[k] ?? 0) + 1;
            return next;
        });
    };

    const listOf = (keys: string[]) => keys.length < 2 ? keys.join('')
        : `${keys.slice(0, -1).join(', ')} ${t('adoptionDocs.list_and')} ${keys[keys.length - 1]}`;

    // ── Contract ────────────────────────────────────────────────────────

    /** Sections this editor changed since they were loaded / last saved. */
    const changedSections = (): SectionKey[] => SECTION_KEYS.filter(k =>
        sectionRevisionText(k, sections[k]) !== sectionRevisionText(k, savedSections[k]));

    /**
     * Send `changes` (each with the revision it was loaded at, or — when
     * resolving a conflict — the teammate's revision). Only items that are
     * clean here go in `loaded`, so the server never pulls a teammate's text
     * over something unsaved in this editor.
     */
    const sendContract = async (changes: Array<{ key: SectionKey; expectedRev: string }>) => {
        if (!revs) return;
        const dirty = new Set<SectionKey>([...changedSections(), ...(Object.keys(conflicts) as SectionKey[])]);
        const loaded: Partial<Record<SectionKey, string>> = {};
        for (const k of SECTION_KEYS) if (!dirty.has(k) || changes.some(c => c.key === k)) loaded[k] = revs.sections[k];
        setSaving(true);
        try {
            const res = await saveContractSections(owner, {
                loaded,
                changes: changes.map(c => ({ key: c.key, doc: storedSection(c.key, sections[c.key]), expectedRev: c.expectedRev })),
            });
            if (!res?.success) { failResult(res); return; }
            const d = res.data;
            const conflictKeys = new Set(d.conflicts.map(c => c.key));
            const pulled = d.updatedByOthers.map(u => u.key as SectionKey);
            // Saved and pulled-in items now read as the server has them.
            const settled = [...d.saved, ...pulled];
            const nextSections = { ...sections };
            const nextSaved = { ...savedSections };
            const remount: SectionKey[] = [];
            for (const k of settled) {
                if (sectionRevisionText(k, nextSections[k]) !== sectionRevisionText(k, d.sections[k])) remount.push(k);
                if (d.sections[k]) { nextSections[k] = d.sections[k]; nextSaved[k] = d.sections[k]; }
                else { delete nextSections[k]; delete nextSaved[k]; }
            }
            setSections(nextSections);
            setSavedSections(nextSaved);
            bump(remount);
            // Every item's revision moves to the server's, except a conflict,
            // which keeps the one this editor loaded until it's resolved.
            setRevs(r => r && ({ ...r, sections: Object.fromEntries(SECTION_KEYS.map(k =>
                [k, conflictKeys.has(k) || (dirty.has(k) && !settled.includes(k)) ? r.sections[k] : d.revisions[k]])) as Record<SectionKey, string> }));
            setConflicts(c => {
                const next = { ...c };
                for (const k of d.saved) delete next[k];
                for (const k of pulled) delete next[k];
                for (const cf of d.conflicts) next[cf.key] = cf;
                return next;
            });
            setUpdatedBy(u => {
                const next = { ...u };
                for (const k of d.saved) delete next[k];
                for (const x of d.updatedByOthers) next[x.key as SectionKey] = x.by;
                return next;
            });

            const mineSaved = d.saved.filter(k => changes.some(c => c.key === k));
            if (mineSaved.length === 1) toast.success(t('adoptionDocs.toast_saved_section').replace('{n}', mineSaved[0]));
            else if (mineSaved.length > 1) toast.success(t('adoptionDocs.toast_saved_sections').replace('{list}', listOf(mineSaved)));
            for (const x of d.updatedByOthers) {
                toast.info(capitalize(t('adoptionDocs.toast_updated_by_other').replace('{name}', x.by || t('adoptionDocs.someone')).replace('{n}', x.key)));
            }
            // A conflict is not an error: the section's banner carries the choice.
            for (const cf of d.conflicts) toast.warning(t('adoptionDocs.toast_needs_review').replace('{n}', cf.key));
            if (!mineSaved.length && !d.updatedByOthers.length && !d.conflicts.length) toast.success(t('settings.saved'));
            await load(false); // refresh "Última edición"
        } catch (error) {
            failToast(resolveErrorId(error, SOURCE));
        } finally {
            setSaving(false);
        }
    };

    const saveContract = async () => {
        if (!revs) return;
        // A section in conflict waits for an explicit choice («Guardar la mía igual» / «Quedarme con…»).
        const keys = changedSections().filter(k => !conflicts[k]);
        await sendContract(keys.map(k => ({ key: k, expectedRev: revs.sections[k] })));
    };

    /** «Guardar la mía igual» / «Guardar esta versión»: overwrite THAT section, still checked against their revision. */
    const keepMineSection = async (k: SectionKey) => {
        const c = conflicts[k];
        if (!c) return;
        await sendContract([{ key: k, expectedRev: c.theirRev }]);
    };

    /** «Quedarme con la de <Nombre>»: take their text, nothing to save. */
    const keepTheirsSection = (k: SectionKey) => {
        const c = conflicts[k];
        if (!c) return;
        setSections(s => { const n = { ...s }; if (c.doc) n[k] = c.doc; else delete n[k]; return n; });
        setSavedSections(s => { const n = { ...s }; if (c.doc) n[k] = c.doc; else delete n[k]; return n; });
        setRevs(r => r && ({ ...r, sections: { ...r.sections, [k]: c.theirRev } }));
        setConflicts(cs => { const n = { ...cs }; delete n[k]; return n; });
        setUpdatedBy(u => ({ ...u, [k]: c.by }));
        bump([k]);
    };

    // ── Form ────────────────────────────────────────────────────────────

    const changedSteps = (): string[] => {
        const now = stepStates(hidden);
        const was = stepStates(savedHidden);
        return TOGGLEABLE_FORM_STEPS.filter(id => now[id] !== was[id]);
    };

    const sendForm = async (changes: Array<{ key: string; expected: 'hidden' | 'shown' }>) => {
        if (!revs) return;
        const dirty = new Set([...changedSteps(), ...Object.keys(stepConflicts)]);
        const loaded: Record<string, 'hidden' | 'shown'> = {};
        for (const id of TOGGLEABLE_FORM_STEPS) if (!dirty.has(id) || changes.some(c => c.key === id)) loaded[id] = revs.steps[id];
        const nowStates = stepStates(hidden);
        setSaving(true);
        try {
            const res = await saveFormSteps(owner, {
                loaded,
                changes: changes.map(c => ({ key: c.key, hidden: nowStates[c.key] === 'hidden', expected: c.expected })),
            });
            if (!res?.success) { failResult(res); return; }
            const d = res.data;
            const conflictKeys = new Set(d.conflicts.map(c => c.key));
            const pulled = d.updatedByOthers.map(u => u.key);
            const settled = new Set([...d.saved, ...pulled]);
            const serverHidden = new Set(d.hiddenSteps);
            // Saved and pulled-in toggles take the server's state; the rest keep this editor's draft.
            const apply = (list: string[]) => {
                const set = new Set(list);
                for (const id of settled) { if (serverHidden.has(id)) set.add(id); else set.delete(id); }
                return TOGGLEABLE_FORM_STEPS.filter(id => set.has(id));
            };
            setHidden(h => apply(h));
            setSavedHidden(h => apply(h));
            setRevs(r => r && ({ ...r, steps: Object.fromEntries(TOGGLEABLE_FORM_STEPS.map(id =>
                [id, conflictKeys.has(id) || (dirty.has(id) && !settled.has(id)) ? r.steps[id] : d.revisions[id]])) }));
            setStepConflicts(c => {
                const next = { ...c };
                for (const id of settled) delete next[id];
                for (const cf of d.conflicts) next[cf.key] = cf;
                return next;
            });
            setStepUpdatedBy(u => {
                const next = { ...u };
                for (const id of d.saved) delete next[id];
                for (const x of d.updatedByOthers) next[x.key] = x.by;
                return next;
            });
            const question = (id: string) => t(id === 'phone-optional' ? 'adoptionDocs.phone_required_question'
                : id.startsWith('identity-') || id === 'selfie' ? `adoptionDocs.step_${id.replace('-', '_')}` : `petshield.fields.${id}`);
            for (const x of d.updatedByOthers) {
                toast.info(capitalize(t('adoptionDocs.toast_step_updated_by_other').replace('{name}', x.by || t('adoptionDocs.someone')).replace('{question}', question(x.key))));
            }
            if (d.conflicts.length) toast.warning(t('adoptionDocs.toast_steps_need_review'));
            if (d.saved.some(id => changes.some(c => c.key === id)) || (!d.conflicts.length && !d.updatedByOthers.length)) toast.success(t('settings.saved'));
            await load(false); // refresh "Última edición"
        } catch (error) {
            failToast(resolveErrorId(error, SOURCE));
        } finally {
            setSaving(false);
        }
    };

    const saveForm = async () => {
        if (!revs) return;
        const keys = changedSteps().filter(id => !stepConflicts[id]);
        await sendForm(keys.map(id => ({ key: id, expected: revs.steps[id] })));
    };

    const keepMineStep = async (id: string) => {
        const c = stepConflicts[id];
        if (!c) return;
        await sendForm([{ key: id, expected: c.theirs }]);
    };

    const keepTheirsStep = (id: string) => {
        const c = stepConflicts[id];
        if (!c) return;
        const setState = (list: string[]) => {
            const set = new Set(list);
            if (c.theirs === 'hidden') set.add(id); else set.delete(id);
            return TOGGLEABLE_FORM_STEPS.filter(s => set.has(s));
        };
        setHidden(h => setState(h));
        setSavedHidden(h => setState(h));
        setRevs(r => r && ({ ...r, steps: { ...r.steps, [id]: c.theirs } }));
        setStepConflicts(cs => { const n = { ...cs }; delete n[id]; return n; });
        setStepUpdatedBy(u => ({ ...u, [id]: c.by }));
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
                    <FormStepsEditor
                        hidden={hidden} onChange={setHidden}
                        conflicts={stepConflicts} updatedBy={stepUpdatedBy} saving={saving}
                        onKeepMine={id => void keepMineStep(id)} onKeepTheirs={keepTheirsStep}
                    />
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
                    <ContractSectionsEditor
                        sections={sections} onChange={setSections} remounts={remounts}
                        conflicts={conflicts} updatedBy={updatedBy} saving={saving}
                        onKeepMine={k => void keepMineSection(k)} onKeepTheirs={keepTheirsSection}
                    />
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
