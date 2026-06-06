'use client';

import { useState, useEffect } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { getOrgActivity, type OrgActivityEntry, type ActivitySeverity } from '@/app/actions/activity';

/**
 * v2.18.14 — team activity feed redesign.
 *
 * The audit_log row + server-side enrichment from getOrgActivity gives us
 * actor name, adopter name, severity tint, and field-summary for edits.
 * Renderer's job here: turn that into a glanceable sentence-per-row UI.
 *
 * Row anatomy:
 *   [tint border] Header: actor name · org chip                     time
 *                 Verb: <action sentence with adopter name>
 *                 Detail: field-level diff or action-specific context
 *                                                          [Ver perfil →]
 *
 * The tint border on the left is the only piece of business logic — it
 * encodes "this is a high-signal event" (flag, deletion, status downgrade)
 * vs "cosmetic". Derived server-side in deriveSeverity so the renderer
 * stays dumb.
 */

const SEVERITY_BORDER: Record<ActivitySeverity, string> = {
    rose: 'border-l-4 border-rose-400',
    amber: 'border-l-4 border-amber-400',
    emerald: 'border-l-4 border-emerald-400',
    stone: 'border-l-4 border-stone-200',
};

const ACTION_ICON: Record<string, string> = {
    adopter_created: '➕',
    adopter_updated: '✏️',
    adoption_added: '🐾',
    adoption_updated: '🐾',
    image_uploaded: '📸',
    flag_created: '🚩',
    adopter_deleted: '🗑️',
    adopter_deletion_requested: '📋',
    verification_added: '✅',
};

function timeAgo(ts: number, isEs: boolean): string {
    const now = Date.now() / 1000;
    const diff = now - ts;
    const mins = Math.floor(diff / 60);
    const hrs = Math.floor(mins / 60);
    const days = Math.floor(hrs / 24);

    if (mins < 1) return isEs ? 'ahora' : 'now';
    if (mins < 60) return isEs ? `hace ${mins} min` : `${mins}m ago`;
    if (hrs < 24) return isEs ? `hace ${hrs}h` : `${hrs}h ago`;
    if (days < 7) return isEs ? `hace ${days}d` : `${days}d ago`;
    return new Date(ts * 1000).toLocaleDateString(isEs ? 'es-AR' : 'en-US', { month: 'short', day: 'numeric' });
}

/**
 * Friendly label for a field key in the adopter_updated diff. Falls back to
 * the raw key when we don't have a translation — better to show
 * "familyMembers" than nothing. We don't want a translation table for every
 * possible field, just the ones that actually appear on the profile form.
 */
function fieldLabel(key: string, isEs: boolean): string {
    const ES: Record<string, string> = {
        name: 'nombre',
        status: 'rating',
        familyMembers: 'integrantes',
        contactInfo: 'contacto',
        addressInfo: 'dirección',
        country: 'país',
        notes: 'notas',
        source: 'fuente',
        sourceUrl: 'URL fuente',
    };
    const EN: Record<string, string> = {
        name: 'name',
        status: 'rating',
        familyMembers: 'family',
        contactInfo: 'contact',
        addressInfo: 'address',
        country: 'country',
        notes: 'notes',
        source: 'source',
        sourceUrl: 'source URL',
    };
    return (isEs ? ES : EN)[key] ?? key;
}

interface VerbLineProps {
    entry: OrgActivityEntry;
    t: (k: string) => string;
    isEs: boolean;
}

/**
 * The action sentence. Adopter name is bolded; when soft-deleted, prepended
 * with "(eliminado)" and rendered as plain text (no link). When the adopter
 * row was hard-deleted we fall back to a generic noun so the row still reads.
 */
function VerbLine({ entry, t, isEs }: VerbLineProps) {
    const adopterFallback = isEs ? 'un perfil' : 'a profile';
    const deletedPrefix = isEs ? '(eliminado) ' : '(deleted) ';
    const adopterNode = entry.adopterName ? (
        entry.adopterDeleted ? (
            <span className="font-semibold text-stone-500">{deletedPrefix}{entry.adopterName}</span>
        ) : entry.target ? (
            <a
                href={`/adopter/${entry.target}`}
                className="font-semibold hover:underline"
                style={{ color: 'var(--text-primary)' }}
            >
                {entry.adopterName}
            </a>
        ) : (
            <span className="font-semibold">{entry.adopterName}</span>
        )
    ) : (
        <span className="text-stone-500 italic">{adopterFallback}</span>
    );

    switch (entry.action) {
        case 'adopter_created':
            return <span>{isEs ? 'creó el perfil de ' : 'created the profile for '}{adopterNode}</span>;
        case 'adopter_updated': {
            const fields = entry.fieldSummary?.primary.map(k => fieldLabel(k, isEs)).join(', ');
            return (
                <span>
                    {isEs ? 'editó ' : 'edited '}
                    {fields && <span className="font-medium text-stone-700">{fields} </span>}
                    {isEs ? 'en ' : 'on '}
                    {adopterNode}
                </span>
            );
        }
        case 'adoption_added': {
            const an = entry.extra.animalName;
            const sp = entry.extra.species;
            return (
                <span>
                    {isEs ? 'registró una adopción en ' : 'registered an adoption on '}
                    {adopterNode}
                    {an && (
                        <span className="text-stone-600">
                            {': '}<span className="font-medium">{an}</span>
                            {sp ? ` (${sp})` : ''}
                        </span>
                    )}
                </span>
            );
        }
        case 'adoption_updated':
            return <span>{isEs ? 'editó una adopción en ' : 'edited an adoption on '}{adopterNode}</span>;
        case 'image_uploaded':
            return <span>{isEs ? 'subió una foto a ' : 'uploaded a photo to '}{adopterNode}</span>;
        case 'flag_created':
            return (
                <span>
                    {isEs ? 'reportó a ' : 'flagged '}{adopterNode}
                    {entry.extra.flagReason && (
                        <span className="text-rose-700 font-medium"> — {entry.extra.flagReason}</span>
                    )}
                </span>
            );
        case 'adopter_deleted':
            return <span>{isEs ? 'eliminó el perfil de ' : 'deleted the profile for '}{adopterNode}</span>;
        case 'adopter_deletion_requested':
            return <span>{isEs ? 'pidió eliminar ' : 'requested deletion of '}{adopterNode}</span>;
        case 'verification_added':
            return <span>{isEs ? 'verificó ' : 'verified '}{adopterNode}</span>;
        default:
            return <span>{t(`organizations.activity_${entry.action}`) || entry.action}</span>;
    }
}

/**
 * Detail line below the verb — only renders when there's something specific
 * to add. For adopter_updated, shows the field-level diff with the "+N más"
 * tail. Other actions surface their extras inline via VerbLine, so the
 * detail line stays empty.
 */
function DetailLine({ entry, isEs }: { entry: OrgActivityEntry; isEs: boolean }) {
    if (entry.action !== 'adopter_updated' || !entry.fieldSummary) return null;
    const details = entry.details ? safeParse(entry.details) : {};
    const changes = (details?.changes as Record<string, { from?: unknown; to?: unknown }>) ?? (details as Record<string, { from?: unknown; to?: unknown }>);
    if (!changes) return null;

    const items = entry.fieldSummary.primary.map(key => {
        const delta = changes[key];
        if (!delta || typeof delta !== 'object') return null;
        const from = formatValue(delta.from);
        const to = formatValue(delta.to);
        return (
            <span key={key} className="inline-flex items-center gap-1 text-xs text-stone-600">
                <span className="font-medium text-stone-700">{fieldLabel(key, isEs)}:</span>
                <span className="line-through text-stone-400 max-w-[8rem] truncate" title={from}>{from || (isEs ? 'vacío' : 'empty')}</span>
                <span className="text-stone-500">→</span>
                <span className="text-stone-800 max-w-[8rem] truncate" title={to}>{to || (isEs ? 'vacío' : 'empty')}</span>
            </span>
        );
    }).filter(Boolean);

    if (items.length === 0) return null;

    return (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
            {items}
            {entry.fieldSummary.extraCount > 0 && (
                <span className="text-xs text-stone-500 italic">
                    +{entry.fieldSummary.extraCount} {isEs ? (entry.fieldSummary.extraCount === 1 ? 'campo más' : 'campos más') : (entry.fieldSummary.extraCount === 1 ? 'more field' : 'more fields')}
                </span>
            )}
        </div>
    );
}

function safeParse(s: string): Record<string, unknown> | null {
    try {
        const v = JSON.parse(s);
        return typeof v === 'object' && v !== null ? v as Record<string, unknown> : null;
    } catch { return null; }
}

function formatValue(v: unknown): string {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    try { return JSON.stringify(v); } catch { return ''; }
}

export default function OrgActivityFeed() {
    const { locale, t } = useLanguage();
    const isEs = locale === 'es';
    const [entries, setEntries] = useState<OrgActivityEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [collapsed, setCollapsed] = useState(false);

    useEffect(() => {
        getOrgActivity(30).then(data => {
            setEntries(data);
            setLoading(false);
        }).catch(() => setLoading(false));
    }, []);

    if (loading) return null;
    if (entries.length === 0) return null;

    return (
        <div
            className="rounded-xl overflow-hidden shadow-sm mb-6"
            style={{ background: 'var(--surface-card)', border: '1px solid var(--border-default)' }}
        >
            {/* Header */}
            <button
                onClick={() => setCollapsed(!collapsed)}
                className="w-full flex items-center justify-between px-5 py-3 text-left transition-colors"
                style={{ borderBottom: collapsed ? 'none' : '1px solid var(--border-default)', background: 'var(--surface-muted)' }}
            >
                <span className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                    📊 {t('organizations.activity_title')}
                    <span className="text-xs font-normal px-1.5 py-0.5 rounded-full" style={{ background: 'var(--accent-subtle-bg)', color: 'var(--accent)' }}>
                        {entries.length}
                    </span>
                </span>
                <svg
                    className={`w-4 h-4 transition-transform ${collapsed ? '' : 'rotate-180'}`}
                    style={{ color: 'var(--text-muted)' }}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {/* Feed */}
            {!collapsed && (
                <div className="max-h-[28rem] overflow-y-auto divide-y" style={{ borderColor: 'var(--border-default)' }}>
                    {entries.map((entry) => {
                        const icon = ACTION_ICON[entry.action] || '📌';
                        return (
                            <article
                                key={entry.id}
                                className={`pl-3 pr-5 py-3 hover:bg-stone-50/60 transition-colors ${SEVERITY_BORDER[entry.severity]}`}
                            >
                                {/* Header line: actor + org chip + time */}
                                <div className="flex items-start justify-between gap-3 mb-0.5">
                                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 min-w-0">
                                        <span className="text-sm font-semibold text-stone-800 truncate max-w-[14rem]" title={entry.userEmail}>
                                            {entry.actorName}
                                        </span>
                                        {entry.actorOrgName && (
                                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-teal-50 text-teal-700">
                                                {entry.actorOrgName}
                                            </span>
                                        )}
                                    </div>
                                    <span className="text-xs flex-shrink-0 mt-0.5" style={{ color: 'var(--text-faint)' }}>
                                        {timeAgo(entry.createdAt, isEs)}
                                    </span>
                                </div>

                                {/* Verb line with icon */}
                                <div className="flex items-start gap-2 text-sm leading-snug" style={{ color: 'var(--text-primary)' }}>
                                    <span className="flex-shrink-0 mt-0.5" aria-hidden>{icon}</span>
                                    <div className="flex-1 min-w-0">
                                        <VerbLine entry={entry} t={t} isEs={isEs} />
                                        <DetailLine entry={entry} isEs={isEs} />
                                        {entry.target && entry.adopterName && !entry.adopterDeleted && (
                                            <a
                                                href={`/adopter/${entry.target}`}
                                                className="text-xs hover:underline mt-1 inline-block"
                                                style={{ color: 'var(--accent)' }}
                                            >
                                                {t('organizations.activity_view_profile')}
                                            </a>
                                        )}
                                    </div>
                                </div>
                            </article>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
