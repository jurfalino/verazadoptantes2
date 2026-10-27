'use client';

/**
 * «¿Es este perfil?» for a person about to be added to a household
 * (households as profiles, prototype A2/A3; also the importer's relatives):
 * the candidate's live summary as this viewer may see it (contacts masked by
 * the server), the contact that matched what was typed marked «coincide», and
 * the candidate's own household line — so a relative of a flagged person is
 * recognised before saving. Answering «Sí» links that profile; «No» moves on.
 */
import { AlertTriangle, Check, Home, Info } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { RatingBadge } from '@/components/RatingBadge';
import { MinorTag } from '@/components/MinorTag';
import { CardHouseholdLine } from '@/components/CardHouseholdLine';
import { MatchesPill } from '@/components/LinkedProfileSummary';
import { ContactRow } from '@/components/ContactRow';
import { deserializeContactEntries, type ContactEntry } from '@/lib/contactEntries';
import { SUMMARY_CONTACT_TYPES, MAX_SUMMARY_CONTACTS } from '@/domain/householdLinks';
import { householdLineGroups } from '@/domain/households';
import { fill, firstName, joinNames } from '@/lib/householdCopy';
import type { HouseholdMatchCandidate } from '@/app/actions/households';

const digits = (s: string) => s.replace(/\D/g, '');

/** True when this contact is the one the typed data matched (phones by their last 8 digits, emails as written). */
export function contactMatched(c: ContactEntry, matchValues: ReadonlyArray<{ type: string; value: string }>): boolean {
    if (c.masked) return false;
    if (c.type === 'phone') {
        const d = digits(c.value);
        return d.length >= 6 && matchValues.some(m => m.type === 'phone' && digits(m.value).slice(-8) === d.slice(-8));
    }
    if (c.type === 'email') return matchValues.some(m => m.type === 'email' && m.value.trim().toLowerCase() === c.value.trim().toLowerCase());
    return false;
}

function reasonKey(matchTypes: readonly string[]): string {
    if (matchTypes.some(m => m.startsWith('phone'))) return 'adopter.hh_candidate_same_phone';
    if (matchTypes.some(m => m.startsWith('email'))) return 'adopter.hh_candidate_same_email';
    if (matchTypes.some(m => m.startsWith('social') || m.startsWith('id'))) return 'adopter.hh_candidate_same_contact';
    return 'adopter.hh_candidate_same_name';
}

export function HouseholdCandidateCard({ candidate, busy, onYes, onNo, testId = 'hh-candidate' }: {
    candidate: HouseholdMatchCandidate;
    busy: boolean;
    onYes: () => void;
    onNo: () => void;
    testId?: string;
}) {
    const { t } = useLanguage();
    const a = candidate.adopter;
    const name = a.name?.trim() || t('adopter.nameless');
    const entries = deserializeContactEntries(a.contactEntries).filter(e => SUMMARY_CONTACT_TYPES.includes(e.type));
    const shown = entries.slice(0, MAX_SUMMARY_CONTACTS);
    // The same count as the household line (final fix P6).
    const alerts = candidate.openAlerts ?? ((candidate.flags.inaccurate ? 1 : 0) + (candidate.flags.duplicate ? 1 : 0));
    const homes = householdLineGroups(candidate.householdLine);
    const others = homes[0]?.map(l => l.name) ?? [];
    const minor = !!candidate.isMinor;
    return (
        <div className="rounded-xl border-2 border-amber-300 bg-amber-50 overflow-hidden" data-testid={testId}>
            <div className="px-4 py-2.5 bg-amber-100 border-b border-amber-300">
                <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 text-amber-800" aria-hidden="true" />
                    <h3 className="text-sm font-bold text-amber-900">{t('adopter.hh_candidate_title')}</h3>
                </div>
                <p className="text-xs text-amber-900 mt-0.5">{t(reasonKey(candidate.matchTypes))}</p>
            </div>
            <div className="px-4 py-3 bg-white/60">
                <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-amber-200 flex items-center justify-center text-amber-900 font-semibold text-sm flex-shrink-0" aria-hidden="true">
                        {(name[0] || '?').toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                            <a href={`/adopter/${encodeURIComponent(candidate.adopterId)}`} target="_blank" rel="noopener noreferrer"
                                data-testid={`${testId}-link`} className="font-semibold text-[15px] text-teal-700 hover:underline break-words">{name}</a>
                            {minor && <MinorTag />}
                        </div>
                        <div className="mt-2 space-y-0.5">
                            {!minor && (
                                <>
                                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm">
                                        {candidate.avgRating != null && candidate.avgRating >= 1
                                            ? <RatingBadge rating={candidate.avgRating} variant="inline" size="md" />
                                            : <span className="text-stone-500">{t('adopter.hh_link_unrated')}</span>}
                                        <span className="text-stone-400" aria-hidden="true">·</span>
                                        {alerts > 0
                                            ? <span className="font-semibold text-rose-700">{alerts === 1 ? t('adopter.hh_link_alerts_one') : fill(t('adopter.hh_link_alerts_many'), { n: alerts })}</span>
                                            : <span className="text-stone-500">{t('adopter.hh_link_no_alerts')}</span>}
                                    </div>
                                    <div className="text-xs text-stone-600">
                                        {candidate.stats.adoptions === 1 ? t('adopter.hh_link_adoptions_one') : fill(t('adopter.hh_link_adoptions_many'), { n: candidate.stats.adoptions })}
                                    </div>
                                </>
                            )}
                        </div>
                        {shown.length > 0 && (
                            <ul className="mt-3 pt-3 border-t border-dashed border-stone-200 space-y-1.5">
                                {shown.map((c, i) => (
                                    <ContactRow key={`${c.id ?? c.type}-${i}`} entry={c} testId="hh-candidate-contact" trailing={contactMatched(c, candidate.matchValues) ? <MatchesPill /> : undefined} />
                                ))}
                            </ul>
                        )}
                    </div>
                </div>
                {homes.length > 0 ? (
                    <>
                        <CardHouseholdLine lines={candidate.householdLine} className="mt-3" />
                        <div className="mt-2 flex items-start gap-2 text-xs px-3 py-2 rounded-lg border" data-testid={`${testId}-elsewhere`}
                            style={{ background: 'var(--status-info-bg)', borderColor: 'var(--status-info-border)', color: 'var(--status-info-text)' }}>
                            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                            <span className="min-w-0 break-words">{fill(t('adopter.hh_candidate_elsewhere'), { name: firstName(name) || name, others: joinNames(t, others) })}</span>
                        </div>
                    </>
                ) : (
                    <div className="mt-3 flex items-start gap-2 text-xs text-stone-600 bg-stone-50 px-3 py-2 rounded-lg border border-stone-100">
                        <Home className="w-3.5 h-3.5 shrink-0 mt-0.5 text-teal-600" aria-hidden="true" />
                        <span className="italic text-stone-500">{t('adopter.hh_no_housemates')}</span>
                    </div>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={onYes} disabled={busy} data-testid={`${testId}-yes`}
                        className="inline-flex min-h-[44px] items-center gap-1.5 px-3.5 text-sm font-semibold rounded-md bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50">
                        <Check className="w-4 h-4" aria-hidden="true" />{t('adopter.hh_candidate_yes')}
                    </button>
                    <button type="button" onClick={onNo} disabled={busy} data-testid={`${testId}-no`}
                        className="inline-flex min-h-[44px] items-center px-3.5 text-sm font-semibold rounded-md border border-stone-200 bg-white text-stone-800 hover:bg-teal-50 disabled:opacity-50">
                        {t('adopter.hh_candidate_no')}
                    </button>
                </div>
            </div>
        </div>
    );
}
