'use client';

import { useLanguage } from '@/context/LanguageContext';
import { PublicProfileSourceNotice } from '@/components/PublicProfileSourceNotice';
import PiiAccessGrantsDisclosure from '@/components/PiiAccessGrantsDisclosure';
import type { AdopterPiiContext } from '@/lib/piiAccess';
import type { VisibilityBadge } from '@/domain/visibilityBadge';

interface VisibilityBadgeModalProps {
    open: boolean;
    onClose: () => void;
    badge: VisibilityBadge;
    sourceUrl?: string | null;
    /** Reason inputs — why does this viewer have (un)access. */
    privileged: boolean;
    isOwner: boolean;
    isAdmin: boolean;
    isOrgMateOfOwner: boolean;
    orgName?: string | null;
    /** "Who has access" ledger — privileged viewers only. */
    accessGrants: AdopterPiiContext['accessGrants'];
    /** Locked branch: a request is already pending for this viewer. */
    requestPending: boolean;
    /** Locked branch: the viewer is in the post-denial cooldown window. */
    requestCooldown: boolean;
    /** Locked branch: the viewer may file a request (piiOptInEligible). */
    canRequest: boolean;
    /** Opens the existing RequestPiiAccessModal. */
    onRequestAccess?: () => void;
    /** Opens the verify-known-info popover ("I already have this detail"). */
    onVerify?: () => void;
}

const EYE = (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M2.5 12S6 5.5 12 5.5s9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" />
    </svg>
);
const LOCK = (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="3.5" y="11" width="17" height="10" rx="2" /><path d="M7.5 11V7.5a4.5 4.5 0 0 1 9 0V11" />
    </svg>
);
const OPEN_LOCK = (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="3.5" y="11" width="17" height="10" rx="2" /><path d="M7.5 11V7a4.5 4.5 0 0 1 8.5-2" />
    </svg>
);

/**
 * Explanatory modal opened by tapping the visibility badge. Content branches on
 * the badge state (and, for the unlocked state, on privilege). The badge itself
 * is the always-visible at-a-glance signal; this is the "what / why / who".
 *
 * - public              → scope + origin disclaimer + source link
 * - protected-locked     → what "protected" means + request-access CTA
 * - protected-unlocked   → why you have access + (privileged) the access ledger,
 *                          or (grantee) a note that it's your own revocable access
 */
export default function VisibilityBadgeModal(props: VisibilityBadgeModalProps) {
    const { t } = useLanguage();
    if (!props.open) return null;

    let icon: React.ReactNode;
    let iconStyle: React.CSSProperties;
    let title: string;
    let sub: string | null = null;
    let body: React.ReactNode = null;

    if (props.badge === 'public') {
        icon = EYE; iconStyle = { backgroundColor: 'var(--status-sky-bg)', color: 'var(--status-sky-text)' };
        title = t('adopter.vis_modal_public_title');
        sub = t('adopter.vis_modal_public_sub');
        body = (
            <div>
                <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>
                    {t('adopter.vis_modal_public_why')}
                </p>
                <PublicProfileSourceNotice sourceUrl={props.sourceUrl} />
            </div>
        );
    } else if (props.badge === 'protected-locked') {
        icon = LOCK; iconStyle = { backgroundColor: 'var(--surface-muted)', color: 'var(--text-muted)' };
        title = t('adopter.vis_modal_locked_title');
        sub = t('adopter.vis_modal_locked_sub');
        body = (
            <div className="space-y-3">
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{t('adopter.vis_modal_locked_body')}</p>
                <div className="space-y-2">
                    {props.onVerify && (
                        <button
                            type="button"
                            onClick={() => { props.onVerify?.(); props.onClose(); }}
                            className="w-full px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors"
                            style={{ background: 'var(--surface-muted)', color: 'var(--text-primary)' }}
                        >
                            {t('adopter.vis_modal_verify_btn')}
                        </button>
                    )}
                    {props.requestPending ? (
                        <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>{t('adopter.vis_modal_request_pending')}</p>
                    ) : (props.canRequest && props.onRequestAccess) ? (
                        <button
                            type="button"
                            onClick={() => { props.onRequestAccess?.(); props.onClose(); }}
                            className="w-full px-4 py-2.5 bg-teal-600 text-white rounded-xl text-sm font-semibold hover:bg-teal-700 transition-colors"
                        >
                            {t('adopter.pii_modal_title')}
                        </button>
                    ) : props.requestCooldown ? (
                        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('adopter.pii_request_cooldown_short')}</p>
                    ) : null}
                </div>
            </div>
        );
    } else {
        // protected-unlocked
        icon = OPEN_LOCK; iconStyle = { backgroundColor: 'var(--accent-badge-bg)', color: 'var(--accent-badge-text)' };
        title = t('adopter.vis_modal_unlocked_title');
        sub = props.privileged
            ? (props.isOwner
                ? t('adopter.vis_reason_owner')
                : props.isOrgMateOfOwner
                    ? t('adopter.vis_reason_org').replace('{org}', props.orgName || t('adopter.vis_reason_org_fallback'))
                    : props.isAdmin
                        ? t('adopter.vis_reason_admin')
                        : t('adopter.vis_reason_privileged'))
            : t('adopter.vis_reason_grant');
        body = props.privileged ? (
            <div>
                <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>
                    {t('adopter.pii_grants_title')}
                </p>
                <PiiAccessGrantsDisclosure grants={props.accessGrants} embedded />
            </div>
        ) : (
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{t('adopter.vis_grant_note')}</p>
        );
    }

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'var(--overlay-bg)' }}
            onClick={props.onClose}
            role="presentation"
        >
            <div
                className="rounded-2xl p-6 max-w-md w-full shadow-xl space-y-4 max-h-[90vh] overflow-y-auto"
                style={{ background: 'var(--surface-card)' }}
                onClick={e => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label={title}
            >
                <div className="flex items-start gap-3">
                    <span className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={iconStyle}>
                        {icon}
                    </span>
                    <div className="min-w-0 flex-1">
                        <h3 className="text-base font-bold leading-tight" style={{ color: 'var(--text-primary)' }}>{title}</h3>
                        {sub && <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>{sub}</p>}
                    </div>
                    <button
                        type="button"
                        onClick={props.onClose}
                        aria-label={t('common.close') || 'Cerrar'}
                        className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-sm"
                        style={{ background: 'var(--surface-muted)', color: 'var(--text-muted)' }}
                    >
                        ✕
                    </button>
                </div>
                {body && <div>{body}</div>}
                {/* Origin disclaimer for a NON-public record that still came from a
                    public source (v2.19.55 coverage: isPublic || sourceUrl). The
                    public branch already renders this in-body; here it's the
                    footer for protected records with a provenance URL. */}
                {props.badge !== 'public' && props.sourceUrl && (
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>
                            {t('adopter.vis_modal_source_title')}
                        </p>
                        <PublicProfileSourceNotice sourceUrl={props.sourceUrl} />
                    </div>
                )}
            </div>
        </div>
    );
}
