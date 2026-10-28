'use client';

/**
 * A notification's type, drawn the same in the bell and on /notificaciones
 * (audit B4): one 20px lucide icon per type (no stored emoji, no bare «+») and
 * its label (`notifications.types.<type>`, es/en/pt). The list of types is
 * domain NOTIFICATION_TYPES; an unknown (legacy) type gets the bell and no label.
 */
import {
    ArrowRightLeft, Bell, CalendarDays, ClipboardList, FileSignature, Flag, GitMerge, Home, Lock, LockOpen,
    MessageSquare, PencilLine, Plug, Settings, ShieldQuestion, Trash2, UserPlus, Users, type LucideIcon,
} from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { NOTIFICATION_TYPES, type NotificationType } from '@/domain/constants';

export const NOTIFICATION_TYPE_ICON: Record<NotificationType, LucideIcon> = {
    contract_result: FileSignature, contract_attached: FileSignature,
    form_submission: ClipboardList, form_attached: ClipboardList,
    api_record: Plug, api_access: Plug, api_access_requested: Plug,
    profile_renamed: PencilLine, profile_rename_undone: PencilLine, profile_age_changed: CalendarDays,
    pii_access_request: Lock, pii_access_approved: LockOpen, pii_access_denied: Lock, pii_access_revoked: Lock,
    contact_entry_added: UserPlus, follow_up_due: Bell, ownership_transferred: ArrowRightLeft,
    adopter_flagged: Flag, deletion_request: Trash2, member_joined: Users,
    adopter_merged: GitMerge, merge_request: GitMerge, merge_request_resolved: GitMerge,
    merge_disputed: ShieldQuestion, merge_dispute_resolved: ShieldQuestion, pair_message: MessageSquare,
    household_linked: Home, household_link_removed: Home, household_link_disputed: ShieldQuestion, household_contribution: Home,
    household_also_lives_with: Home, household_relationship_changed: Home, household_member_removed: Home, household_member_disputed: ShieldQuestion,
    system: Settings,
};

const KNOWN: ReadonlySet<string> = new Set(NOTIFICATION_TYPES);

export function NotificationTypeIcon({ type, className = 'w-5 h-5' }: { type: string; className?: string }) {
    const Icon = KNOWN.has(type) ? NOTIFICATION_TYPE_ICON[type as NotificationType] : Bell;
    return <Icon className={`${className} shrink-0`} style={{ color: 'var(--accent)' }} strokeWidth={1.75} aria-hidden="true" />;
}

/** The type's words, or null for a type the app no longer writes. */
export function useNotificationTypeLabel() {
    const { t } = useLanguage();
    return (type: string): string | null => (KNOWN.has(type) ? t(`notifications.types.${type}`) || null : null);
}
