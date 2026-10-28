'use client';

/**
 * «¿Es este perfil?» for a person about to be added to a household
 * (households as profiles, prototype A2/A3; also the importer's relatives):
 * the candidate's live summary as this viewer may see it (contacts masked by
 * the server), the contact that matched what was typed marked «coincide», and
 * the candidate's own household line — so a relative of a flagged person is
 * recognised before saving. Answering «Sí» links that profile; «No» moves on.
 */
import { Check, HelpCircle, Home, Info } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { alertCountOf } from '@/domain/flags';
import { useLanguage } from '@/context/LanguageContext';
import { PersonStanding, PersonActivity } from '@/components/PersonStanding';
import { CardHouseholdLine } from '@/components/CardHouseholdLine';
import { MatchesPill } from '@/components/LinkedProfileSummary';
import { ContactRow } from '@/components/ContactRow';
import { deserializeContactEntries, type ContactEntry } from '@/lib/contactEntries';
import { SUMMARY_CONTACT_TYPES, MAX_SUMMARY_CONTACTS } from '@/domain/householdLinks';
import { householdLineGroups } from '@/domain/households';
import { fill, firstName } from '@/lib/householdCopy';
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
    const alerts = candidate.openAlerts ?? alertCountOf(candidate.flags);
    const homes = householdLineGroups(candidate.householdLine);
    const minor = !!candidate.isMinor;
    return (
        // A question, not a warning (audit B15): the neutral info look, and the person drawn as every other person
        // (the household row's teal initial); the alerts, if any, are the person's own AlertPill.
        <div className="rounded-xl border overflow-hidden bg-white" style={{ borderColor: 'var(--status-info-border)' }} data-testid={testId}>
            <div className="px-4 py-2.5 border-b" style={{ background: 'var(--status-info-bg)', borderColor: 'var(--status-info-border)' }}>
                <div className="flex items-center gap-2">
                    <HelpCircle className="w-4 h-4 shrink-0" style={{ color: 'var(--status-info-text)' }} aria-hidden="true" />
                    <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{t('adopter.hh_candidate_title')}</h3>
                </div>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{t(reasonKey(candidate.matchTypes))}</p>
            </div>
            <div className="px-4 py-3">
                <div className="flex items-start gap-2">
                    <span className="mt-0.5 w-8 h-8 rounded-full bg-teal-600 text-white font-bold text-xs flex items-center justify-center shrink-0" aria-hidden="true">
                        {(name[0] || '?').toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                        {/* Name, standing and activity exactly as a household row writes them (PersonStanding). */}
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                            <a href={`/adopter/${encodeURIComponent(candidate.adopterId)}`} target="_blank" rel="noopener noreferrer"
                                data-testid={`${testId}-link`} className="font-semibold text-[15px] text-teal-700 hover:underline break-words">{name}</a>
                            <PersonStanding rating={candidate.rating ?? candidate.avgRating} openAlerts={alerts} isMinor={minor} alertsTestId={`${testId}-alerts`} />
                            {candidate.activity && <PersonActivity activity={candidate.activity} isMinor={minor} testId={`${testId}-activity`} />}
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
                            {/* The housemates are named once, in the line above (audit B15). */}
                            <span className="min-w-0 break-words">{fill(t('adopter.hh_candidate_elsewhere'), { name: firstName(name) || name })}</span>
                        </div>
                    </>
                ) : (
                    <div className="mt-3 flex items-start gap-2 text-xs text-stone-600 bg-stone-50 px-3 py-2 rounded-lg border border-stone-100">
                        <Home className="w-3.5 h-3.5 shrink-0 mt-0.5 text-teal-600" aria-hidden="true" />
                        <span className="italic text-stone-500">{t('adopter.hh_no_housemates')}</span>
                    </div>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                    <Button type="button" size="compact" onClick={onYes} disabled={busy} data-testid={`${testId}-yes`} icon={<Check className="w-4 h-4" aria-hidden="true" />}>
                        {t('adopter.hh_candidate_yes')}
                    </Button>
                    <Button type="button" variant="secondary" size="compact" onClick={onNo} disabled={busy} data-testid={`${testId}-no`}>
                        {t('adopter.hh_candidate_no')}
                    </Button>
                </div>
            </div>
        </div>
    );
}
