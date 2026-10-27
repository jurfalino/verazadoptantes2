'use client';

/**
 * A household member's contacts (D46, households as profiles; compact rows,
 * addendum 2026-10-27): the panel a member row opens from «N datos ▾».
 *
 * It IS the profile's own contact list — ContactEntriesSection, in server mode
 * on THAT person's profile — so a household contact looks, links, edits and is
 * added exactly as on the profile («Agregar dato de contacto», D55: saved on
 * that person's profile through `addContactEntry`, same rules). The contacts
 * are as the server masked them for this viewer (padlock + partial value).
 * Edit/delete appear where they would on that person's profile: everything for
 * its owner or an admin, a contributor's own entries for them.
 *
 * `MatchesPill` marks, in «¿Es este perfil?» (HouseholdCandidateCard), the
 * contact that matched what was typed.
 */
import { Check } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import ContactEntriesSection from '@/components/ContactEntriesSection';
import type { LinkedSummary } from '@/domain/householdLinks';
import { fill } from '@/lib/householdCopy';

/** The «coincide» pill on the contact that matched what was typed. */
export function MatchesPill() {
    const { t } = useLanguage();
    return (
        <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-teal-100 text-teal-800" data-testid="contact-matches">
            <Check className="w-3 h-3" aria-hidden="true" />{t('adopter.hh_candidate_matches')}
        </span>
    );
}

export function MemberContacts({ summary, testId = 'linked-summary', canAddContact = false, canEditAll = false, currentUser }: {
    summary: LinkedSummary;
    testId?: string;
    /** Signed in: «Agregar dato de contacto» adds to this person's own profile (D55). */
    canAddContact?: boolean;
    /** The viewer owns that person's profile, or is an admin: edit/delete every entry, as on the profile. */
    canEditAll?: boolean;
    /** The viewer's email: their own contributions stay editable, as on the profile. */
    currentUser?: string;
}) {
    const { t } = useLanguage();
    const anyLocked = summary.contacts.some(c => c.masked);
    return (
        <div className="min-w-0 space-y-2" data-testid={testId}>
            <ContactEntriesSection
                entries={summary.contacts}
                adopterId={summary.profileId}
                canEditAll={canEditAll}
                currentUser={currentUser}
                canAdd={canAddContact}
                // The household has its own «protected» note below; the profile-level line is the profile's.
                hideVisibilityMicrocopy
                testIdPrefix="linked-contact"
            />
            {summary.moreContacts > 0 && (
                <p className="text-xs text-stone-500">{fill(t('adopter.hh_link_more_contacts'), { n: summary.moreContacts })}</p>
            )}
            {anyLocked && <p className="text-xs text-stone-500">{t('adopter.hh_link_locked_note')}</p>}
        </div>
    );
}
