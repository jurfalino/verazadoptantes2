'use client';
import { useMemo, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { userFacingMessage, handledAsStale } from '@/lib/errorMessage';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { StarRating } from '@/components/StarRating';
import { completeInterview } from '@/app/actions/interviewComplete';
import { contactKey } from '@/domain/interview/facts';
import type { CandidateSummary, ContactValue, HouseholdValue, KnownFacts } from '@/domain/interview/types';
import CandidateCard from './CandidateCard';

const LABEL = 'block text-xs font-semibold text-teal-800 mb-1.5 uppercase tracking-wider';
type Item = { key: string; label: string; contact?: ContactValue; address?: string; household?: HouseholdValue };

export default function InterviewReview({ interviewId, known, candidates, confirmedAdopterId, leadCandidateId, flush, onBack, onSaved }: {
    interviewId: string;
    known: KnownFacts;
    candidates: CandidateSummary[];
    confirmedAdopterId: string | null;
    leadCandidateId: string | null;
    flush: () => Promise<boolean>;
    onBack: () => void;
    onSaved: (adopterId: string) => void;
}) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const [target, setTarget] = useState<string | null>(confirmedAdopterId); // D2: no default unless started from a profile
    const [unticked, setUnticked] = useState<Set<string>>(new Set());
    const [rating, setRating] = useState(0);
    const [summary, setSummary] = useState('');
    const [saving, setSaving] = useState(false);
    const chosen = candidates.find(c => c.adopterId === target) ?? null;
    const canEdit = target === 'new' || !!chosen?.canEdit;

    const items: Item[] = useMemo(() => {
        const visibleKeys = new Set<string>();
        if (chosen) {
            chosen.visible.phones?.forEach(v => visibleKeys.add(`phone:${contactKey('phone', v)}`));
            chosen.visible.emails?.forEach(v => visibleKeys.add(`email:${contactKey('email', v)}`));
            chosen.visible.socials?.forEach(v => visibleKeys.add(`social:${contactKey('social', v)}`));
        }
        const contacts: ContactValue[] = [
            ...known.phones.map(value => ({ type: 'phone' as const, value })),
            ...known.emails.map(value => ({ type: 'email' as const, value })),
            ...known.socials.map(value => ({ type: 'social' as const, value })),
        ];
        return [
            ...contacts.map(c => {
                const k = `${c.type}:${contactKey(c.type, c.value)}`;
                return { key: k, label: `${t(`interview.contact_type_${c.type}`)}: ${c.value}${visibleKeys.has(k) ? ` (${t('interview.review_already')})` : ''}`, contact: c };
            }),
            ...(known.address ? [{ key: 'address', label: `${t('interview.prep_address')}: ${known.address}`, address: known.address }] : []),
            ...known.household.map((h, i) => ({ key: `hh:${i}`, label: `${h.name || '—'}${h.relationship ? ` · ${t(`adopter.hh_rel_${h.relationship}`)}` : ''}`, household: h })),
        ];
    }, [known, chosen, t]);

    async function save() {
        if (!target) { toast.warning(t('interview.review_pick_required')); return; }
        setSaving(true);
        try {
            await flush();
            const ticked = items.filter(i => !unticked.has(i.key));
            const r = await completeInterview(interviewId, {
                adopterId: target,
                additions: {
                    contacts: ticked.flatMap(i => i.contact ? [i.contact] : []),
                    address: ticked.find(i => i.address)?.address ?? null,
                    household: ticked.flatMap(i => i.household ? [i.household] : []),
                },
                rating: rating > 0 ? rating : null,
                summary: summary.trim() || null,
            });
            if (r.ok) onSaved(r.adopterId);
            else toast.error(t(r.error === 'disabled' ? 'interview.disabled' : 'interview.save_failed'), undefined, r.errorId);
        } catch (e) {
            if (!handledAsStale(e)) toast.error(t('interview.save_failed'), userFacingMessage(e, t('interview.save_failed')), resolveErrorId(e, 'InterviewReview.save'));
        } finally {
            setSaving(false);
        }
    }

    return (
        <section className="max-w-3xl mx-auto space-y-6" data-testid="interview-review">
            <h1 className="text-xl font-bold text-stone-900">{t('interview.review_title')}</h1>

            <div>
                <h2 className={LABEL}>{t('interview.review_who')}</h2>
                <div className="grid gap-2 md:grid-cols-2" role="radiogroup">
                    {candidates.map(c => (
                        <CandidateCard key={c.adopterId} c={c} selected={target === c.adopterId} onSelect={() => setTarget(c.adopterId)}
                            selectLabel={c.displayName} badge={c.adopterId === leadCandidateId ? t('interview.prep_lead_selected') : undefined} />
                    ))}
                    {!confirmedAdopterId && (
                        <button type="button" data-testid="interview-review-new" role="radio" aria-checked={target === 'new'} onClick={() => setTarget('new')}
                            className={`text-left rounded-xl border p-3 bg-white ${target === 'new' ? 'border-teal-500 ring-2 ring-teal-500/20' : 'border-stone-200'}`}>
                            <span className="block text-sm font-semibold text-stone-900">{t('interview.review_new_person')}</span>
                            <span className="block text-xs text-stone-500 mt-0.5">{t('interview.review_new_person_desc')}</span>
                        </button>
                    )}
                </div>
            </div>

            {target && (
                <div>
                    <h2 className={LABEL}>{t('interview.review_add_title')}</h2>
                    {!canEdit ? <p className="text-sm text-stone-600">{t('interview.review_cannot_edit')}</p>
                        : items.length === 0 ? <p className="text-sm text-stone-600">{t('interview.review_nothing_new')}</p>
                        : (
                            <ul className="space-y-1.5">
                                {items.map(i => (
                                    <li key={i.key}>
                                        <label className="flex items-start gap-2 text-sm text-stone-800">
                                            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-teal-700" checked={!unticked.has(i.key)}
                                                onChange={e => setUnticked(prev => { const n = new Set(prev); if (e.target.checked) n.delete(i.key); else n.add(i.key); return n; })} />
                                            <span className="break-all">{i.label}</span>
                                        </label>
                                    </li>
                                ))}
                            </ul>
                        )}
                </div>
            )}

            <div>
                <label className={LABEL}>{t('interview.review_rating')}</label>
                <StarRating value={rating} onChange={setRating} size="lg" showLabel />
            </div>
            <div>
                <label className={LABEL} htmlFor="interview-summary">{t('interview.review_summary')}</label>
                <textarea id="interview-summary" rows={3} value={summary} onChange={e => setSummary(e.target.value)} maxLength={2000}
                    className="w-full p-3 rounded-lg border border-teal-200 bg-white text-teal-950 font-medium focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 outline-none resize-none text-base md:text-sm" />
                <p className="text-xs text-stone-500 mt-1">{t('interview.review_summary_public')}</p>
            </div>

            <div className="flex justify-between items-center pt-4 border-t border-teal-100/50">
                <button type="button" onClick={onBack} className="px-4 py-2 text-sm font-semibold text-teal-700 hover:bg-teal-50 rounded-lg">← {t('interview.review_back')}</button>
                <button type="button" data-testid="interview-review-save" disabled={saving || !target} onClick={save}
                    className="px-6 py-2 text-sm font-semibold text-white bg-teal-700 rounded-lg hover:bg-teal-600 shadow-md shadow-teal-700/20 disabled:opacity-50 transition-all">
                    {saving ? t('interview.saving') : t('interview.review_save')}
                </button>
            </div>
        </section>
    );
}
