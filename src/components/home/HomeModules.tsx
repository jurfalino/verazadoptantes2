'use client';

/**
 * Homepage modules for the signed-in rescuer: Mis adoptantes, Mis animales,
 * Posts de redes — below the search, in place of the action cards when
 * ENABLE_CLEAN_HOMEPAGE is off. Design: .agents/plans/2026-11-04-home-modules.md
 *
 * Rules every card follows:
 * - A count equals the count on the page it opens.
 * - A row reuses the words and look of the page it summarizes.
 * - An empty module is never a card: it is a step of «Para empezar» /
 *   «También podés» (orderHomeModules).
 * - A list shows at most 3 rows (2 under amber rows), then «Ver los N …».
 */

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { timeAgo } from '@/lib/timeAgo';
import { RatingBadge } from '@/components/RatingBadge';
import { GroupChip } from '@/components/GroupChip';
import { keepNumberWithUnit, keepCountsTogether } from '@/lib/keepNumberWithUnit';
import ContactPickerLauncher from '@/components/ContactPickerLauncher';
import GoogleContactsPickerLauncher from '@/components/GoogleContactsPickerLauncher';
// Plain imports, never next/dynamic: on the Cloudflare build (next-on-pages) a dynamic chunk in this edge
// page crashed the homepage («async__chunk_… is not defined», v2.58.43 CI). Both render only once opened.
import HomeDuePanel from '@/components/home/HomeDuePanel';
import PendingDedup from '@/components/PendingDedup';
import { getHomeModules } from '@/app/actions/homeModules';
import { orderHomeModules, homeAdopterRowCount, HOME_CARD_SLOTS, postsCardLive, type HomeModuleKey, type HomeModuleState } from '@/domain/homeModules';
import { HOME_POSTS_WINDOW_DAYS } from '@/config/constants';
import { followupBadgeLabel } from '@/lib/followupBadgeLabel';
import { adopterDisplayName } from '@/lib/adopterDisplay';
import { interpolate } from '@/lib/interpolate';
import { detectSocialPlatform, SOCIAL_PLATFORMS } from '@/lib/contactEntries';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { handledAsStale } from '@/lib/errorMessage';
import type { HomeAdoptersData, HomeAnimalRow, HomeAnimalsData, HomeModulesData, HomePendingItem, HomePostsData, HomeSection } from '@/types/homeModules';

type T = (key: string) => string;

// ── Icons (SVG, currentColor) ──────────────────────────────────────────────

const PATHS = {
    post: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12',
    people: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z',
    paw: 'M12 21c-2.5 0-5-1.5-5-4 0-2 2-3.5 3-5s1-2 2-2 1 .5 2 2 3 3 3 5c0 2.5-2.5 4-5 4zM5.5 11.5a1.75 2.25 0 100-4.5 1.75 2.25 0 000 4.5zM18.5 11.5a1.75 2.25 0 100-4.5 1.75 2.25 0 000 4.5zM9 7a1.75 2.25 0 100-4.5A1.75 2.25 0 009 7zM15 7a1.75 2.25 0 100-4.5A1.75 2.25 0 0015 7z',
    person: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
    contacts: 'M3 5a2 2 0 012-2h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5zm9 4a3 3 0 100 6 3 3 0 000-6zm-4.5 9.5h9a4.5 4.5 0 00-9 0z',
    chevron: 'M9 5l7 7-7 7',
    plus: 'M12 5v14m-7-7h14',
} as const;

function Icon({ name, className = 'w-5 h-5' }: { name: keyof typeof PATHS; className?: string }) {
    return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={PATHS[name]} />
        </svg>
    );
}

/** «1 adoptante» / «46 adoptantes». */
const count = (t: T, n: number, one: string, many: string) => interpolate(t(n === 1 ? one : many), { n });

// ── Building blocks ────────────────────────────────────────────────────────

/** «+ Agregar» beside the title: `label` is the visible word, `aria` names what it adds. */
type ModuleAdd = { href: string; label: string; aria: string };

/**
 * The header (icon + title + summary) opens the module's page in every state.
 * With `add`, a «+ Agregar» button takes the chevron's place beside it — the
 * module's create action, shown whatever the card's state (Jon 2026-11-09).
 * It is a sibling of the title link, never inside it.
 */
function ModuleShell({ icon, title, summary, href, children, testId, add, className = '' }: {
    icon: keyof typeof PATHS; title: string; summary?: string; href: string; children: ReactNode; testId: string; add?: ModuleAdd; className?: string;
}) {
    // Desktop: the header is 60px whether the summary takes one line or two
    // (Mis animales' «N disponibles · M adoptados» wraps beside «Agregar»), so
    // two cards side by side start their slots at the same height.
    return (
        <section data-testid={testId} className={`bg-white rounded-2xl border border-stone-200 p-4 shadow-sm ${className}`}>
            <div className="flex items-center gap-3 md:min-h-[60px]">
                <Link href={href} data-testid={`${testId}-header`} className="flex flex-1 min-w-0 items-center gap-3 min-h-11 group">
                    <span className="w-10 h-10 shrink-0 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center">
                        <Icon name={icon} />
                    </span>
                    <span className="flex-1 min-w-0">
                        <span className="block text-base font-bold text-stone-900 leading-tight group-hover:text-teal-700">{title}</span>
                        {summary && <span data-testid={`${testId}-summary`} className="block text-sm text-stone-500 leading-snug">{keepCountsTogether(summary)}</span>}
                    </span>
                    {!add && <Icon name="chevron" className="w-4 h-4 text-stone-400 shrink-0" />}
                </Link>
                {add && (
                    <Link href={add.href} data-testid={`${testId}-add`} aria-label={add.aria}
                        className="btn btn-compact btn-secondary min-h-11 shrink-0 whitespace-nowrap">
                        <Icon name="plus" className="w-4 h-4" />
                        {add.label}
                    </Link>
                )}
            </div>
            <div className="mt-4 space-y-4">{children}</div>
        </section>
    );
}

/**
 * One slot of Mis adoptantes / Mis animales (HOME_CARD_SLOTS): a row is 56px
 * on desktop, and an amber row or the import link (44px) plus a 12px gap is
 * 56px too — so a card's height depends only on how many slots it fills.
 * Phones stack the cards, so their rows keep wrapping freely.
 */
const SLOT_ROW = 'md:h-14 md:py-0';
const SLOT_PX = 56;
/** «Ver los N …» (MoreRow, min-h-11). */
const MORE_PX = 44;
const SLOT_GAP_ABOVE = 'mt-3';
const SLOT_GAP_BELOW = 'mb-3';

/**
 * The amber «pendiente» row from the /my-animals cards: same 12px bold text,
 * radius and colors; min-h-11 adds the tap target.
 */
function TodoRow({ children, href, testId, className = '' }: { children: ReactNode; href: string; testId: string; className?: string }) {
    return (
        <Link href={href} data-testid={testId} className={`flex items-center w-full min-h-11 px-4 py-2 rounded-lg text-xs font-bold bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors [overflow-wrap:anywhere] ${className}`}>
            {children}
        </Link>
    );
}

/**
 * One animal: its photo (or the species placeholder), its name, one line under
 * it — amber when a check-up is due. With `onOpen` (a check-up due) the row
 * opens «Para hacer ahora» over the home instead of going to the animal's page
 * (HomeDuePanel); it looks the same either way.
 */
function AnimalRow({ href, testId, name, photo, species, line, due = false, onOpen }: {
    href: string; testId: string; name: string; photo: string | null; species: string | null; line: string; due?: boolean; onOpen?: () => void;
}) {
    const rowClass = `flex items-center gap-3 min-h-11 py-2 group ${SLOT_ROW}`;
    const body = (
        <>
            <span className="w-10 h-10 shrink-0 rounded-lg bg-stone-200 overflow-hidden flex items-center justify-center">
                {photo
                    ? <img src={photo} alt="" className="w-full h-full object-cover" />
                    : <img src={`/placeholders/${species === 'cat' ? 'cat' : species === 'dog' ? 'dog' : 'paw'}.png`} alt="" className="w-7 h-7 object-contain opacity-60" />}
            </span>
            <span className="flex-1 min-w-0">
                <span title={name} className="block text-sm font-semibold text-stone-900 group-hover:text-teal-700 [overflow-wrap:anywhere] md:truncate">{name}</span>
                <span title={line} className={`block text-xs [overflow-wrap:anywhere] md:truncate ${due ? 'font-semibold text-amber-700' : 'text-stone-500'}`}>{keepNumberWithUnit(line)}</span>
            </span>
        </>
    );
    return onOpen
        ? <button type="button" onClick={onOpen} aria-haspopup="dialog" data-testid={testId} className={`w-full text-left ${rowClass}`}>{body}</button>
        : <Link href={href} data-testid={testId} className={rowClass}>{body}</Link>;
}

function MoreRow({ label, href, testId }: { label: string; href: string; testId: string }) {
    return (
        <Link href={href} data-testid={testId} className="flex items-center justify-between gap-2 min-h-11 pt-2 text-sm font-semibold text-teal-700 hover:underline underline-offset-4">
            <span>{label}</span>
            <Icon name="chevron" className="w-4 h-4 shrink-0" />
        </Link>
    );
}

const ROWS = 'divide-y divide-stone-200';

/**
 * Same avatar as /my-adopters: the profile photo, else the person silhouette.
 * The rating sits on the right of the name line, as on /my-adopters (the page
 * this card summarizes) — never wherever the name happens to end, so every row
 * of the list has the same shape and the ratings read straight down.
 * Desktop: one slot (56px) — the name and the grey line (with the group tag)
 * each keep to one line, cut with «…»; phones wrap them.
 */
function PersonRow({ id, name, thumbnail, avgRating, meta, chip, t }: {
    id: string; name: string | null; thumbnail: string | null; avgRating: number | null; meta: string; chip?: ReactNode; t: T;
}) {
    const display = adopterDisplayName({ name }, t('adopter.nameless'));
    return (
        <Link href={`/adopter/${encodeURIComponent(id)}`} data-testid="home-person-row" className={`flex items-start md:items-center gap-3 min-h-11 py-2 group ${SLOT_ROW}`}>
            <span className="w-10 h-10 shrink-0 rounded-full bg-stone-100 border border-stone-200 overflow-hidden flex items-center justify-center text-stone-500">
                {thumbnail ? <img src={thumbnail} alt="" className="w-full h-full object-cover" /> : <Icon name="person" className="w-4 h-4" />}
            </span>
            <span className="flex-1 min-w-0 flex flex-col gap-1">
                <span className="flex items-start gap-2 min-w-0">
                    <span title={display} className="flex-1 min-w-0 text-sm font-semibold text-stone-900 group-hover:text-teal-700 line-clamp-2 [overflow-wrap:anywhere] md:line-clamp-none md:truncate">{display}</span>
                    <span className="shrink-0"><RatingBadge rating={avgRating} /></span>
                </span>
                <span className="flex flex-wrap md:flex-nowrap items-center gap-x-2 gap-y-1 min-w-0 text-xs text-stone-500 [overflow-wrap:anywhere]">
                    <span className="min-w-0 md:truncate">{meta}</span>
                    {chip}
                </span>
            </span>
        </Link>
    );
}

/**
 * Loading placeholder for one module, built on ModuleShell's measurements:
 * header (icon, title + summary, «+ Agregar»), one row per slot
 * (HOME_CARD_SLOTS), the «Ver los N …» line — the height a full card has.
 * Themed base classes only (see project_theming).
 */
function ModuleSkeleton() {
    const bar = 'bg-stone-200 rounded';
    return (
        <div className="bg-white rounded-2xl border border-stone-200 p-4 shadow-sm">
            <div className="flex items-center gap-3 min-h-11 md:min-h-[60px]">
                <div className="w-10 h-10 shrink-0 rounded-xl bg-stone-200" />
                <div className="flex-1 min-w-0 space-y-2">
                    <div className={`${bar} h-4 w-32`} />
                    <div className={`${bar} h-3 w-24`} />
                </div>
                <div className="h-11 w-24 shrink-0 rounded-xl bg-stone-200" />
            </div>
            <div className="mt-4">
                <div className={ROWS}>
                    {Array.from({ length: HOME_CARD_SLOTS }, (_, i) => (
                        <div key={i} className={`flex items-center gap-3 min-h-11 py-2 ${SLOT_ROW}`}>
                            <div className="w-10 h-10 shrink-0 rounded-full bg-stone-200" />
                            <div className="flex-1 min-w-0 space-y-2">
                                <div className={`${bar} h-3.5 w-2/5`} />
                                <div className={`${bar} h-3 w-3/5`} />
                            </div>
                        </div>
                    ))}
                </div>
                <div className="flex items-center min-h-11 pt-2">
                    <div className={`${bar} h-3.5 w-36`} />
                </div>
            </div>
        </div>
    );
}

function SectionError({ errorId, t }: { errorId: string; t: T }) {
    return (
        <p className="text-sm text-stone-600">
            {t('homeModules.load_failed')} <span className="text-xs text-stone-500">({t('homeModules.error_code')}: {errorId})</span>
        </p>
    );
}

// ── Mis adoptantes ─────────────────────────────────────────────────────────

/** What Mis adoptantes lists — shared by the card and the desktop layout. */
function adopterParts(d: HomeAdoptersData, hasContacts: boolean) {
    const hasTodo = d.pendingReview > 0;
    const showContacts = !hasTodo && hasContacts;
    const rows = d.recent.slice(0, homeAdopterRowCount(hasTodo || showContacts));
    return { hasTodo, showContacts, rows, more: d.total > rows.length, slots: rows.length + (hasTodo || showContacts ? 1 : 0) };
}

/** What Mis animales lists — shared by the card and the desktop layout. */
function animalParts(d: HomeAnimalsData) {
    const moreDue = d.dueCount - d.rows.filter(a => a.due).length;
    return { moreDue, more: d.total > d.rows.length, slots: d.rows.length + (moreDue > 0 ? 1 : 0) };
}

export function AdoptersCard({ section, contacts, t, rel, className, onOpenPending }: {
    section: HomeSection<HomeAdoptersData>; contacts: ReactNode; t: T; rel: (ms: number) => string; className?: string;
    /** Opens the first pending row over the home (PendingDedup's home mode). */
    onOpenPending?: () => void;
}) {
    if (!section.ok) {
        return <ModuleShell icon="people" title={t('homeModules.adopters_title')} href="/my-adopters" testId="home-adopters" className={className}><SectionError errorId={section.errorId} t={t} /></ModuleShell>;
    }
    const d = section.data;
    const { hasTodo, showContacts, rows, more } = adopterParts(d, contacts != null);
    const meta = (r: HomeAdoptersData['recent'][number]) => r.viaForm
        ? interpolate(t('homeModules.via_form'), { when: rel(r.createdAt) })
        : r.creatorIsSelf || !r.creatorName
            ? interpolate(t('homeModules.created'), { when: rel(r.createdAt) })
            : interpolate(t('homeModules.created_by'), { name: r.creatorName, when: rel(r.createdAt) });
    return (
        <ModuleShell icon="people" title={t('homeModules.adopters_title')} summary={count(t, d.total, 'homeModules.adopters_one', 'homeModules.adopters_many')} href="/my-adopters" testId="home-adopters"
            add={{ href: '/adopter/create', label: t('homeModules.add'), aria: t('homeModules.add_adopter') }} className={className}>
            {/* One block, so the slots sit at their own fixed spacing (SLOT_*). */}
            <div>
                {hasTodo && d.firstPending && onOpenPending && (
                    <PendingItemRow item={d.firstPending} n={d.pendingReview} onOpen={onOpenPending} t={t} className={SLOT_GAP_BELOW} />
                )}
                {hasTodo && !(d.firstPending && onOpenPending) && (
                    <TodoRow href="/my-adopters#pendientes" testId="home-adopters-pending" className={SLOT_GAP_BELOW}>
                        {count(t, d.pendingReview, 'homeModules.pending_review_one', 'homeModules.pending_review_many')}
                    </TodoRow>
                )}
                <div className={ROWS}>
                    {rows.map(r => (
                        <PersonRow key={r.id} {...r} t={t} meta={meta(r)} chip={r.groupName ? <GroupChip name={r.groupName} self={r.creatorIsSelf} /> : undefined} />
                    ))}
                </div>
                {more && (
                    <MoreRow href="/my-adopters" testId="home-adopters-more" label={interpolate(t('homeModules.see_adopters'), { n: d.total })} />
                )}
                {showContacts && <div className={SLOT_GAP_ABOVE}>{contacts}</div>}
            </div>
        </ModuleShell>
    );
}

/**
 * Mis adoptantes' amber row, naming the first row whose next move is the
 * viewer's (Jon 2026-11-09, option A): «¿Es la misma persona? · 1 de N» (or
 * «María te pide unir», or — the viewer's request declined — «María no aceptó
 * unir») over the two names as «Pendientes de
 * revisar» shows them. It opens that row over the home. Same 44px as the
 * other amber rows, one slot.
 */
function PendingItemRow({ item, n, onOpen, t, className = '' }: { item: HomePendingItem; n: number; onOpen: () => void; t: T; className?: string }) {
    const [a, b] = item.names;
    const names = a.trim() === b.trim() ? `${a} ×2` : `${a} / ${b}`;
    const who = item.by || t('myAdopters.pending_dedup_a_user');
    const head = item.group === 'received' ? interpolate(t('homeModules.pending_asks'), { name: who })
        : item.group === 'declined' ? interpolate(t('homeModules.pending_declined'), { name: who })
            : t('samePerson.question');
    return (
        <button type="button" onClick={onOpen} aria-haspopup="dialog" data-testid="home-adopters-pending"
            className={`flex items-center gap-2 w-full min-h-11 md:h-11 px-4 py-1.5 rounded-lg text-left bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors ${className}`}>
            <span className="flex-1 min-w-0">
                <span className="block text-xs font-bold [overflow-wrap:anywhere] md:truncate">
                    {head} <span className="font-semibold">· {interpolate(t('homeModules.pending_position'), { n })}</span>
                </span>
                <span title={names} className="block text-xs font-semibold text-amber-800 [overflow-wrap:anywhere] md:truncate">{names}</span>
            </span>
            <Icon name="chevron" className="w-4 h-4 shrink-0" />
        </button>
    );
}

// ── Mis animales ───────────────────────────────────────────────────────────

export function AnimalsCard({ section, t, className, onOpenDue }: {
    section: HomeSection<HomeAnimalsData>; t: T; className?: string;
    /** Opens «Para hacer ahora» for an animal with a check-up due (HomeDuePanel). */
    onOpenDue?: (a: { id: string; name: string }) => void;
}) {
    if (!section.ok) {
        return <ModuleShell icon="paw" title={t('homeModules.animals_title')} href="/my-animals" testId="home-animals" className={className}><SectionError errorId={section.errorId} t={t} /></ModuleShell>;
    }
    const d = section.data;
    const now = Date.now();
    const summary = d.available === 0
        ? interpolate(t('homeModules.animals_none_available'), { adopted: count(t, d.adopted, 'homeModules.adopted_one', 'homeModules.adopted_many') })
        : `${count(t, d.available, 'homeModules.available_one', 'homeModules.available_many')} · ${count(t, d.adopted, 'homeModules.adopted_one', 'homeModules.adopted_many')}`;
    // The grey line, worded as on the /my-animals card.
    const status = (a: HomeAnimalRow) => {
        const who = adopterDisplayName({ name: a.personName }, t('adopter.nameless'));
        if (a.status === 'foster') return `${t('dashboard.in_foster_with')} ${who}`;
        if (a.status === 'adopted') return `${t('dashboard.adopted_by')} ${who}`;
        return a.applicants > 0
            ? `${t('homeModules.available_status')} · ${a.applicants} ${t(a.applicants === 1 ? 'animalProfile.applicant_one' : 'animalProfile.applicant_many')}`
            : t('homeModules.available_status');
    };
    const { moreDue, more } = animalParts(d);
    return (
        <ModuleShell icon="paw" title={t('homeModules.animals_title')} summary={summary} href={d.available === 0 ? '/my-animals?view=adopted' : '/my-animals'} testId="home-animals"
            add={{ href: '/my-animals/new', label: t('homeModules.add'), aria: t('homeModules.add_animal') }} className={className}>
            {d.rows.length > 0 && (
                <div>
                    {/* Animals that need you first (a check-up due), then the most recently updated. */}
                    <div className={ROWS}>
                        {d.rows.map(a => a.due
                            ? <AnimalRow key={a.id} href={`/my-animals/${encodeURIComponent(a.id)}#next-action`} testId="home-animals-due"
                                name={a.name || t('homeModules.unnamed_animal')} photo={a.photo} species={a.species} due
                                onOpen={onOpenDue ? () => onOpenDue({ id: a.id, name: a.name || t('homeModules.unnamed_animal') }) : undefined}
                                line={followupBadgeLabel(t, a.due.dueFollowups, a.due.dueTop, now, { short: true })} />
                            : <AnimalRow key={a.id} href={`/my-animals/${encodeURIComponent(a.id)}`} testId="home-animal-row"
                                name={a.name || t('homeModules.unnamed_animal')} photo={a.photo} species={a.species} line={status(a)} />)}
                    </div>
                    {moreDue > 0 && (
                        <TodoRow href="/my-animals?view=pendientes" testId="home-animals-due-more" className={SLOT_GAP_ABOVE}>
                            {count(t, moreDue, 'homeModules.more_due_one', 'homeModules.more_due_many')}
                        </TodoRow>
                    )}
                    {more && (
                        <MoreRow href="/my-animals?view=todos" testId="home-animals-more" label={interpolate(t('homeModules.see_all_animals'), { n: d.total })} />
                    )}
                </div>
            )}
        </ModuleShell>
    );
}

// ── Posts de redes ─────────────────────────────────────────────────────────

/** «Facebook», «Instagram», … — else the link's host. */
function networkName(url: string): string {
    const platform = detectSocialPlatform(url);
    const known = platform && SOCIAL_PLATFORMS.find(p => p.key === platform);
    if (known) return known.label;
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

function PostsCard({ section, t, rel }: { section: HomeSection<HomePostsData>; t: T; rel: (ms: number) => string }) {
    if (!section.ok) {
        return <ModuleShell icon="post" title={t('homeModules.posts_title')} href="/my-adopters?filtro=posts" testId="home-posts"><SectionError errorId={section.errorId} t={t} /></ModuleShell>;
    }
    const d = section.data;
    return (
        <ModuleShell icon="post" title={t('homeModules.posts_title')} summary={count(t, d.people, 'homeModules.post_people_one', 'homeModules.post_people_many')} href="/my-adopters?filtro=posts" testId="home-posts">
            <div>
                <div className={ROWS}>
                    {d.recent.map(r => (
                        <PersonRow key={r.id} {...r} t={t} meta={interpolate(t('homeModules.post_meta'), { network: networkName(r.sourceUrl), when: rel(r.at) })} />
                    ))}
                </div>
                {d.people > d.recent.length && (
                    <MoreRow href="/my-adopters?filtro=posts" testId="home-posts-more" label={interpolate(t('homeModules.see_post_people'), { n: d.people })} />
                )}
            </div>
            <Link href="/import" className="btn btn-standard btn-secondary w-full">{t('homeModules.import_another')}</Link>
        </ModuleShell>
    );
}

// ── «Para empezar» / «También podés» ───────────────────────────────────────

const STEPS: Record<HomeModuleKey, { icon: keyof typeof PATHS; key: string; href: string }> = {
    adopters: { icon: 'people', key: 'adopters', href: '/adopter/create' },
    animals: { icon: 'paw', key: 'animals', href: '/my-animals/new' },
    posts: { icon: 'post', key: 'posts', href: '/import' },
};

function FirstSteps({ steps, title, t }: { steps: HomeModuleKey[]; title: string; t: T }) {
    return (
        <section data-testid="home-first-steps" className="bg-white rounded-2xl border border-stone-200 px-4 py-2 shadow-sm">
            <h2 className="flex items-center min-h-11 text-base font-bold text-stone-900">{title}</h2>
            <div className={ROWS}>
                {steps.map(k => (
                    <Link key={k} href={STEPS[k].href} data-testid={`home-step-${k}`} className="flex items-center gap-3 min-h-14 py-3 group">
                        <span className="w-10 h-10 shrink-0 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center">
                            <Icon name={STEPS[k].icon} />
                        </span>
                        <span className="flex-1 min-w-0">
                            <span className="block text-sm font-bold text-stone-900 group-hover:text-teal-700">{t(`homeModules.step_${STEPS[k].key}_title`)}</span>
                            <span className="block text-xs text-stone-500 leading-snug">{t(`homeModules.step_${STEPS[k].key}_desc`)}</span>
                        </span>
                        <Icon name="chevron" className="w-4 h-4 text-stone-400 shrink-0" />
                    </Link>
                ))}
            </div>
        </section>
    );
}

// ── The stack ──────────────────────────────────────────────────────────────

function stateOf<D>(section: HomeSection<D> | null, todo: (d: D) => boolean, content: (d: D) => boolean): HomeModuleState {
    if (!section) return 'off';
    // A card that failed to load still shows (with its errorId) — never silently missing.
    if (!section.ok) return 'content';
    return todo(section.data) ? 'todo' : content(section.data) ? 'content' : 'empty';
}

export default function HomeModules({ contactImportAvailable, googleContactsImportEnabled }: {
    contactImportAvailable: boolean;
    googleContactsImportEnabled: boolean;
}) {
    const { t, locale } = useLanguage();
    const [data, setData] = useState<HomeModulesData | null | undefined>(undefined);
    const [failedId, setFailedId] = useState<string | null>(null);
    /** The animal whose «Para hacer ahora» is open over the home. */
    const [duePanel, setDuePanel] = useState<{ id: string; name: string } | null>(null);
    const alive = useRef(true);

    // First load shows the skeleton; a reload (after registering a check-up
    // from the panel) keeps the cards on screen and swaps the data in.
    const loaded = useRef(false);
    const load = useCallback(() => {
        getHomeModules()
            .then(d => { if (!alive.current) return; loaded.current = true; setData(d); setFailedId(null); })
            .catch((e: unknown) => {
                if (!alive.current) return;
                // An older tab: the page reloads itself; meanwhile show nothing rather than a skeleton forever.
                if (handledAsStale(e)) { setData(null); return; }
                const errorId = resolveErrorId(e, 'HomeModules');
                // A reload after a panel action that fails keeps the cards on screen (one may be a
                // little behind); only a first load with nothing to show becomes the error box.
                if (!loaded.current) setFailedId(errorId);
            });
    }, []);

    useEffect(() => {
        alive.current = true;
        load();
        return () => { alive.current = false; };
    }, [load]);
    const closeDuePanel = useCallback(() => setDuePanel(null), []);
    /** «¿Es la misma persona?» open over the home (option A). Stable, so the panel's loader isn't recreated each render. */
    const [pendingOpen, setPendingOpen] = useState(false);
    const pendingPanel = useMemo(() => ({ onChanged: load, onClose: () => setPendingOpen(false) }), [load]);

    // Same compact wording as /my-adopters' «Creado por … hace 4 sem».
    const rel = (ms: number) => timeAgo(new Date(ms), locale !== 'en');

    if (failedId) {
        return (
            <section data-testid="home-modules-error" className="bg-white rounded-2xl border border-stone-200 p-4 shadow-sm">
                <SectionError errorId={failedId} t={t} />
            </section>
        );
    }
    // Two placeholder cards in the real cards' shape and grid, so the page
    // doesn't change shape or jump when Mis adoptantes / Mis animales arrive.
    if (data === undefined) {
        return (
            <div data-testid="home-modules-loading" aria-hidden="true" className="grid grid-cols-1 gap-4 md:grid-cols-2 animate-pulse">
                <ModuleSkeleton />
                <ModuleSkeleton />
            </div>
        );
    }
    if (data === null) return null;

    const now = Date.now();
    const posts = data.posts && data.posts.ok && !postsCardLive(data.posts.data.lastPostAt, now, HOME_POSTS_WINDOW_DAYS)
        ? ({ ok: true, data: { ...data.posts.data, people: 0, recent: [] } } as HomeSection<HomePostsData>)
        : data.posts;
    const { cards, steps, firstSteps } = orderHomeModules({
        adopters: stateOf(data.adopters, d => d.pendingReview > 0, d => d.total > 0),
        animals: stateOf(data.animals, d => d.dueCount > 0, d => d.total > 0),
        posts: stateOf(posts, () => false, d => d.people > 0),
    });

    const contacts = contactImportAvailable ? (
        <ContactPickerLauncher testId="home-import-contacts" onPicked={() => { window.location.href = '/import?contact_import=1'; }}
            className="flex items-center justify-center gap-2 w-full min-h-11 text-sm font-semibold text-teal-700 hover:underline underline-offset-4">
            <Icon name="contacts" className="w-4 h-4" />
            {t('homeModules.import_contacts')}
        </ContactPickerLauncher>
    ) : googleContactsImportEnabled ? (
        <GoogleContactsPickerLauncher testId="home-import-google-contacts" onPicked={() => { window.location.href = '/import?contact_import=1'; }}
            className="flex items-center justify-center gap-2 w-full min-h-11 text-sm font-semibold text-teal-700 hover:underline underline-offset-4">
            <Icon name="contacts" className="w-4 h-4" />
            {t('homeModules.import_contacts')}
        </GoogleContactsPickerLauncher>
    ) : null;

    // Desktop, Mis adoptantes beside Mis animales (Jon 2026-11-09, options 1 + 4):
    // both are built from the same slots, so they normally come out the same
    // height and the grid's stretch evens out any last pixel. When they can't
    // match — fewer people/animals than slots, no «Ver los N» — neither card is
    // stretched into an empty gap: the taller one spans two grid rows, so the
    // next card (e.g. «También podés») moves up under the shorter one. DOM order
    // is untouched, so phones (one column) read exactly as before.
    const deskHeight = (p: { slots: number; more: boolean } | null) => (p ? p.slots * SLOT_PX + (p.more ? MORE_PX : 0) : 0);
    const ai = cards.indexOf('adopters');
    const ni = cards.indexOf('animals');
    const paired = ai >= 0 && ni >= 0 && Math.floor(ai / 2) === Math.floor(ni / 2);
    const adoptersH = deskHeight(data.adopters.ok ? adopterParts(data.adopters.data, contacts != null) : null);
    const animalsH = deskHeight(data.animals?.ok ? animalParts(data.animals.data) : null);
    const taller: HomeModuleKey | null = !paired || adoptersH === animalsH ? null : adoptersH > animalsH ? 'adopters' : 'animals';
    const spanIf = (k: HomeModuleKey) => (k === taller ? 'md:row-span-2' : '');

    const card = (k: HomeModuleKey) => {
        if (k === 'adopters') return <AdoptersCard key={k} section={data.adopters} contacts={contacts} t={t} rel={rel} className={spanIf(k)} onOpenPending={() => setPendingOpen(true)} />;
        if (k === 'animals' && data.animals) return <AnimalsCard key={k} section={data.animals} t={t} className={spanIf(k)} onOpenDue={setDuePanel} />;
        if (k === 'posts' && posts) return <PostsCard key={k} section={posts} t={t} rel={rel} />;
        return null;
    };

    const items = cards.map(card).filter(Boolean);
    if (steps.length > 0) {
        items.push(
            <FirstSteps key="steps" steps={steps} t={t}
                title={t(firstSteps === 'start' ? 'homeModules.first_steps_start' : 'homeModules.first_steps_more')} />,
        );
    }

    // Desktop: two columns inside the page's own width, read left to right (see
    // the pairing note above). A lone card stays full width rather than leaving
    // an empty column beside it. Phones: one column — grid-cols-1
    // (minmax(0, 1fr)), never the implicit auto column, which grows to a card's
    // widest content (a long group chip beside the rating) and pushed the page
    // wider than a 360px phone.
    return (
        <>
            <div data-testid="home-modules" className={items.length > 1 ? `grid grid-cols-1 gap-4 md:grid-cols-2 ${taller ? 'md:items-start' : ''}` : 'space-y-4'}>
                {items}
            </div>
            {duePanel && <HomeDuePanel key={duePanel.id} animalId={duePanel.id} animalName={duePanel.name} onClose={closeDuePanel} onChanged={load} />}
            {pendingOpen && <PendingDedup home={pendingPanel} />}
        </>
    );
}
