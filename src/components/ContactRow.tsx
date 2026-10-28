'use client';

/**
 * ONE contact row, wherever a person's contact details are shown: the
 * profile's own list (ContactEntriesSection), a household member's list (which
 * IS a ContactEntriesSection) and «¿Es este perfil?» (HouseholdCandidateCard).
 *
 *   [icon] Teléfono   +54 9 11 5555-1234 (WhatsApp)          ✎ 🗑
 *
 * - `ContactLead`: the type icon (a network's own logo for a branded social)
 *   and the type label — 96px from `sm:` up, screen-reader-only below it,
 *   where the icon already says it and the value needs the width.
 * - `ContactValue`: the value as a link (tel:, mailto:, maps, the network),
 *   a phone's WhatsApp/Telegram logos, and a protected value as the padlock +
 *   partial value — a button when the viewer can ask to see it.
 * - `ContactRow`: lead + value + whatever trails it (edit/delete, «coincide»).
 *
 * Before this existed the household drew its own rows (smaller label, no
 * links, no app logos, a different padlock), so the same phone looked like
 * two different things one section apart.
 */
import type { ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { CONTACT_TYPE_ICON } from '@/components/ContactTypePicker';
import { useLanguage } from '@/context/LanguageContext';
import { SocialLogo } from '@/components/SocialLogo';
import { MessagingLogo } from '@/components/MessagingLogo';
import { socialUrl, phoneAppUrl, SOCIAL_PLATFORMS, type ContactEntry, type ContactEntryType, type SocialPlatform } from '@/lib/contactEntries';
import { renderTextWithLinks } from '@/lib/textUtils';
import { BreakableEmail } from '@/components/ui/BreakableEmail';
import { TAP_TARGET_44 } from '@/components/ui/tapTarget';

/** Per-network brand label (Facebook / Instagram / ...), keyed by platform. */
const SOCIAL_LABEL = Object.fromEntries(SOCIAL_PLATFORMS.map(p => [p.key, p.label])) as Record<SocialPlatform, string>;

/** A contact value's link (tel:, mailto:, maps, the network): 44px to the touch, as it looks (TAP_TARGET_44). */
const LINK_CLASS = `text-teal-700 hover:underline ${TAP_TARGET_44}`;
/**
 * A phone's WhatsApp / Telegram logo link: a 44×44 box on phones (it sits right after the number,
 * so an ::after would reach over the number's last digits), the bare 15px logo from `sm:`.
 */
const APP_LOGO_LINK = 'inline-flex items-center justify-center min-w-11 min-h-11 -my-3.5 sm:min-w-0 sm:min-h-0 sm:my-0';

/**
 * A social entry that renders with its OWN network icon + name (Facebook,
 * Instagram, TikTok, X, Threads) instead of the generic "@ Red social" row.
 * Masked rows keep the branded icon + name — only the handle is hidden; which
 * network it is isn't treated as PII.
 */
export function brandedSocialPlatform(entry: ContactEntry): Exclude<SocialPlatform, 'other'> | null {
    if (entry.type !== 'social') return null;
    const p = entry.platform;
    return p && p !== 'other' ? (p as Exclude<SocialPlatform, 'other'>) : null;
}

function socialHref(value: string): string | null {
    const v = value.trim();
    if (!v) return null;
    if (/^https?:\/\//i.test(v)) return v;
    if (/^[\w-]+(\.[\w-]+)+\//.test(v)) return `https://${v}`;
    return null;
}

/** «Teléfono», or a document's own label («DNI»). */
export function useContactLabel() {
    const { t } = useLanguage();
    return (entry: ContactEntry): string =>
        entry.type === 'id' && entry.label?.trim() ? entry.label.trim() : t(`adopter.ce_type_${entry.type}`);
}

/** The row's icon + type label (see the file comment for the label's widths). */
export function ContactLead({ entry }: { entry: ContactEntry }) {
    const labelFor = useContactLabel();
    const branded = brandedSocialPlatform(entry);
    const Icon = CONTACT_TYPE_ICON[entry.type];
    return (
        <>
            {branded
                ? <SocialLogo platform={branded} size={16} className="mt-0.5 shrink-0" />
                : <Icon className="w-4 h-4 mt-0.5 shrink-0 text-teal-600" aria-hidden="true" />}
            {/* The icon already states the type, so below `sm:` the label is a second copy
                costing a fixed 96px the value needs on a phone: sr-only there, so it is
                still announced (the icon is aria-hidden). */}
            <span className="sr-only sm:not-sr-only sm:w-24 sm:shrink-0 text-stone-500">{branded ? SOCIAL_LABEL[branded] : labelFor(entry)}</span>
        </>
    );
}

/** The value as the viewer may see it. `onMaskedClick` makes a protected value the «verify» button. */
export function ContactValue({ entry, onMaskedClick }: { entry: ContactEntry; onMaskedClick?: (type: ContactEntryType) => void }) {
    const { t } = useLanguage();
    const labelFor = useContactLabel();
    if (entry.masked) {
        if (onMaskedClick) {
            return (
                <button
                    type="button"
                    onClick={() => onMaskedClick(entry.type)}
                    aria-label={t('adopter.pii_masked_chip_aria')}
                    className={`inline-flex items-center gap-1.5 text-stone-500 hover:text-teal-700 hover:bg-teal-50 -mx-1.5 -my-0.5 px-1.5 py-0.5 rounded-md transition-colors cursor-pointer group ${TAP_TARGET_44}`}
                >
                    <Lock className="w-3 h-3 opacity-60 group-hover:opacity-100" aria-hidden="true" />
                    <span className="select-none">{entry.value}</span>
                </button>
            );
        }
        // Not tappable here, but the same padlock + partial value as the button above.
        return (
            <span className="inline-flex items-center gap-1.5 text-stone-500" aria-label={`${labelFor(entry)}: ${t('adopter.ce_masked')}`}>
                <Lock className="w-3 h-3 opacity-60 shrink-0" aria-hidden="true" />
                <span className="select-none">{entry.value}</span>
            </span>
        );
    }
    if (entry.type === 'phone') {
        const tel = <a href={`tel:${entry.value.replace(/[^\d+]/g, '')}`} className={LINK_CLASS}>{entry.value}</a>;
        if (!entry.apps?.length) return tel;
        return (
            <span className="inline-flex items-center gap-1.5 flex-wrap">
                {tel}
                {entry.apps.map(app => {
                    const u = phoneAppUrl(app, entry.value);
                    const logo = <MessagingLogo app={app} size={15} />;
                    return u
                        ? <a key={app} href={u} target="_blank" rel="noopener noreferrer" title={app === 'whatsapp' ? 'WhatsApp' : 'Telegram'} aria-label={app === 'whatsapp' ? 'WhatsApp' : 'Telegram'} className={APP_LOGO_LINK}>{logo}</a>
                        : <span key={app} title={app === 'whatsapp' ? 'WhatsApp' : 'Telegram'}>{logo}</span>;
                })}
            </span>
        );
    }
    // Wraps before «@» and the domain's dots, never mid-word when a piece fits (BreakableEmail, audit B20).
    if (entry.type === 'email') return <a href={`mailto:${entry.value}`} className={LINK_CLASS}><BreakableEmail email={entry.value} /></a>;
    if (entry.type === 'address') {
        const query = encodeURIComponent(entry.value.replace(/\n/g, ', '));
        return <a href={`https://www.google.com/maps/search/?api=1&query=${query}`} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>{entry.value}</a>;
    }
    if (entry.type === 'social') {
        const href = socialUrl(entry.value, entry.platform) ?? socialHref(entry.value);
        const inner = href
            ? <a href={href} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>{entry.value}</a>
            : <span className="text-stone-800">{entry.value}</span>;
        // Branded networks carry their icon + name in the lead, so the value is only the handle;
        // 'other' keeps its inline generic-link mark (its row stays "@ Red social").
        return entry.platform === 'other'
            ? <span className="inline-flex items-center gap-1.5"><SocialLogo platform="other" size={15} />{inner}</span>
            : inner;
    }
    if (entry.type === 'other') return <span className="text-stone-700">{renderTextWithLinks(entry.value)}</span>;
    return <span className="text-stone-800">{entry.value}</span>;
}

/** The value cell, with whatever trails it on the right. */
export function ContactValueCell({ entry, onMaskedClick, trailing, wrapTrailing = false }: {
    entry: ContactEntry; onMaskedClick?: (type: ContactEntryType) => void; trailing?: ReactNode;
    /** A wide trailing mark («coincide») goes under the value instead of squeezing it into a sliver. */
    wrapTrailing?: boolean;
}) {
    return (
        <div className={`flex items-start justify-between gap-2 ${wrapTrailing ? 'flex-wrap gap-y-1' : ''}`}>
            <span className={`font-medium text-stone-800 flex-1 ${wrapTrailing ? 'min-w-[9rem]' : 'min-w-0'}`} style={{ overflowWrap: 'anywhere' }}>
                <ContactValue entry={entry} onMaskedClick={onMaskedClick} />
            </span>
            {trailing}
        </div>
    );
}

/** A read-only contact row (e.g. «¿Es este perfil?»): exactly the profile's row, with an optional trailing mark. */
export function ContactRow({ entry, trailing, testId = 'contact-row' }: { entry: ContactEntry; trailing?: ReactNode; testId?: string }) {
    return (
        // 44px on phones, like the profile's own rows (ContactEntriesSection): the value's 44px tap target never overlaps the next row's.
        <li className="flex items-start gap-2 text-sm py-3 sm:py-0" data-testid={testId} data-entry-type={entry.type}>
            <ContactLead entry={entry} />
            <div className="flex-1 min-w-0">
                <ContactValueCell entry={entry} trailing={trailing} wrapTrailing />
            </div>
        </li>
    );
}
