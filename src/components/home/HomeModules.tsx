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
import { useEffect, useState, type ReactNode } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { timeAgo } from '@/lib/timeAgo';
import { RatingBadge } from '@/components/RatingBadge';
import ContactPickerLauncher from '@/components/ContactPickerLauncher';
import GoogleContactsPickerLauncher from '@/components/GoogleContactsPickerLauncher';
import { getHomeModules } from '@/app/actions/homeModules';
import { orderHomeModules, homeListLimit, dueRowsShown, postsCardLive, type HomeModuleKey, type HomeModuleState } from '@/domain/homeModules';
import { HOME_POSTS_WINDOW_DAYS } from '@/config/constants';
import { followupBadgeLabel } from '@/lib/followupBadgeLabel';
import { adopterDisplayName } from '@/lib/adopterDisplay';
import { interpolate } from '@/lib/interpolate';
import { detectSocialPlatform, SOCIAL_PLATFORMS } from '@/lib/contactEntries';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { handledAsStale } from '@/lib/errorMessage';
import type { HomeAdoptersData, HomeAnimalsData, HomeModulesData, HomePostsData, HomeSection } from '@/types/homeModules';

type T = (key: string) => string;

// ── Icons (SVG, currentColor) ──────────────────────────────────────────────

const PATHS = {
    post: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12',
    people: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z',
    paw: 'M12 21c-2.5 0-5-1.5-5-4 0-2 2-3.5 3-5s1-2 2-2 1 .5 2 2 3 3 3 5c0 2.5-2.5 4-5 4zM5.5 11.5a1.75 2.25 0 100-4.5 1.75 2.25 0 000 4.5zM18.5 11.5a1.75 2.25 0 100-4.5 1.75 2.25 0 000 4.5zM9 7a1.75 2.25 0 100-4.5A1.75 2.25 0 009 7zM15 7a1.75 2.25 0 100-4.5A1.75 2.25 0 0015 7z',
    person: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
    contacts: 'M3 5a2 2 0 012-2h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5zm9 4a3 3 0 100 6 3 3 0 000-6zm-4.5 9.5h9a4.5 4.5 0 00-9 0z',
    chevron: 'M9 5l7 7-7 7',
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

/** The header (icon + title + summary) opens the module's page in every state. */
function ModuleShell({ icon, title, summary, href, children, testId }: {
    icon: keyof typeof PATHS; title: string; summary?: string; href: string; children: ReactNode; testId: string;
}) {
    return (
        <section data-testid={testId} className="bg-white rounded-2xl border border-stone-200 p-4 shadow-sm">
            <Link href={href} data-testid={`${testId}-header`} className="flex items-center gap-3 min-h-11 group">
                <span className="w-10 h-10 shrink-0 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center">
                    <Icon name={icon} />
                </span>
                <span className="flex-1 min-w-0">
                    <span className="block text-base font-bold text-stone-900 leading-tight group-hover:text-teal-700">{title}</span>
                    {summary && <span data-testid={`${testId}-summary`} className="block text-sm text-stone-500 leading-snug">{summary}</span>}
                </span>
                <Icon name="chevron" className="w-4 h-4 text-stone-400 shrink-0" />
            </Link>
            <div className="mt-4 space-y-4">{children}</div>
        </section>
    );
}

/**
 * The amber «pendiente» row from the /my-animals cards: same 12px bold text,
 * radius and colors; min-h-11 adds the tap target.
 */
function TodoRow({ children, href, testId }: { children: ReactNode; href: string; testId: string }) {
    return (
        <Link href={href} data-testid={testId} className="flex items-center w-full min-h-11 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors [overflow-wrap:anywhere]">
            {children}
        </Link>
    );
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

/** The /my-adopters group chip: stone for your own rows, teal for a teammate's. */
function GroupChip({ name, self }: { name: string; self: boolean }) {
    return <span className={`inline-flex px-1.5 py-0.5 rounded-full text-[11px] font-medium ${self ? 'bg-stone-100 text-stone-600' : 'bg-teal-50 text-teal-700'}`}>{name}</span>;
}

/** Same avatar as /my-adopters: the profile photo, else the person silhouette. */
function PersonRow({ id, name, thumbnail, avgRating, meta, chip, t }: {
    id: string; name: string | null; thumbnail: string | null; avgRating: number | null; meta: string; chip?: ReactNode; t: T;
}) {
    const display = adopterDisplayName({ name }, t('adopter.nameless'));
    return (
        <Link href={`/adopter/${encodeURIComponent(id)}`} data-testid="home-person-row" className="flex items-center gap-3 min-h-11 py-2 group">
            <span className="w-9 h-9 shrink-0 rounded-full bg-stone-100 border border-stone-200 overflow-hidden flex items-center justify-center text-stone-500">
                {thumbnail ? <img src={thumbnail} alt="" className="w-full h-full object-cover" /> : <Icon name="person" className="w-4 h-4" />}
            </span>
            <span className="flex-1 min-w-0">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-semibold text-stone-900 group-hover:text-teal-700 line-clamp-2 [overflow-wrap:anywhere]">{display}</span>
                    <RatingBadge rating={avgRating} />
                </span>
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-stone-500 [overflow-wrap:anywhere]">
                    <span>{meta}</span>
                    {chip}
                </span>
            </span>
        </Link>
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

function AdoptersCard({ section, contacts, t, rel }: { section: HomeSection<HomeAdoptersData>; contacts: ReactNode; t: T; rel: (ms: number) => string }) {
    if (!section.ok) {
        return <ModuleShell icon="people" title={t('homeModules.adopters_title')} href="/my-adopters" testId="home-adopters"><SectionError errorId={section.errorId} t={t} /></ModuleShell>;
    }
    const d = section.data;
    const hasTodo = d.pendingReview > 0 || d.formsToReview > 0;
    const rows = d.recent.slice(0, homeListLimit(hasTodo));
    const meta = (r: HomeAdoptersData['recent'][number]) => r.viaForm
        ? interpolate(t('homeModules.via_form'), { when: rel(r.createdAt) })
        : r.creatorIsSelf || !r.creatorName
            ? interpolate(t('homeModules.created'), { when: rel(r.createdAt) })
            : interpolate(t('homeModules.created_by'), { name: r.creatorName, when: rel(r.createdAt) });
    return (
        <ModuleShell icon="people" title={t('homeModules.adopters_title')} summary={count(t, d.total, 'homeModules.adopters_one', 'homeModules.adopters_many')} href="/my-adopters" testId="home-adopters">
            {hasTodo && (
                <div className="space-y-2">
                    {d.pendingReview > 0 && (
                        <TodoRow href="/my-adopters#pendientes" testId="home-adopters-pending">
                            {count(t, d.pendingReview, 'homeModules.pending_review_one', 'homeModules.pending_review_many')}
                        </TodoRow>
                    )}
                    {d.formsToReview > 0 && (
                        <TodoRow href="/my-adopters?filtro=por-revisar" testId="home-adopters-forms">
                            {count(t, d.formsToReview, 'homeModules.forms_review_one', 'homeModules.forms_review_many')}
                        </TodoRow>
                    )}
                </div>
            )}
            <div>
                <div className={ROWS}>
                    {rows.map(r => (
                        <PersonRow key={r.id} {...r} t={t} meta={meta(r)} chip={r.groupName ? <GroupChip name={r.groupName} self={r.creatorIsSelf} /> : undefined} />
                    ))}
                </div>
                {d.total > rows.length && (
                    <MoreRow href="/my-adopters" testId="home-adopters-more" label={interpolate(t('homeModules.see_adopters'), { n: d.total })} />
                )}
            </div>
            {!hasTodo && (
                <div>
                    <Link href="/adopter/create" className="btn btn-standard btn-secondary w-full">{t('homeModules.register_adopter')}</Link>
                    {contacts}
                </div>
            )}
        </ModuleShell>
    );
}

// ── Mis animales ───────────────────────────────────────────────────────────

function AnimalsCard({ section, t }: { section: HomeSection<HomeAnimalsData>; t: T }) {
    if (!section.ok) {
        return <ModuleShell icon="paw" title={t('homeModules.animals_title')} href="/my-animals" testId="home-animals"><SectionError errorId={section.errorId} t={t} /></ModuleShell>;
    }
    const d = section.data;
    const { rows: dueRows, moreCount } = dueRowsShown(d.due);
    const now = Date.now();
    const summary = d.available === 0
        ? interpolate(t('homeModules.animals_none_available'), { adopted: count(t, d.adopted, 'homeModules.adopted_one', 'homeModules.adopted_many') })
        : `${count(t, d.available, 'homeModules.available_one', 'homeModules.available_many')} · ${count(t, d.adopted, 'homeModules.adopted_one', 'homeModules.adopted_many')}`;
    const status = (a: HomeAnimalsData['listed'][number]) => a.fosterName
        ? `${t('dashboard.in_foster_with')} ${adopterDisplayName({ name: a.fosterName }, t('adopter.nameless'))}`
        : a.applicants > 0
            ? `${t('homeModules.available_status')} · ${a.applicants} ${t(a.applicants === 1 ? 'animalProfile.applicant_one' : 'animalProfile.applicant_many')}`
            : t('homeModules.available_status');
    return (
        <ModuleShell icon="paw" title={t('homeModules.animals_title')} summary={summary} href={d.available === 0 ? '/my-animals?view=adopted' : '/my-animals'} testId="home-animals">
            {dueRows.length > 0 && (
                <div className="space-y-2">
                    {dueRows.map(a => (
                        <TodoRow key={a.id} href={`/my-animals/${encodeURIComponent(a.id)}#next-action`} testId="home-animals-due">
                            {(a.name ? `${a.name} · ` : '') + followupBadgeLabel(t, a.dueFollowups, a.dueTop, now)}
                        </TodoRow>
                    ))}
                    {moreCount > 0 && (
                        <TodoRow href="/my-animals?view=pendientes" testId="home-animals-due-more">
                            {interpolate(t('homeModules.more_due'), { n: moreCount })}
                        </TodoRow>
                    )}
                </div>
            )}
            {d.listed.length > 0 && (
                <div>
                    <div className={ROWS}>
                        {d.listed.slice(0, homeListLimit(dueRows.length > 0)).map(a => (
                            <Link key={a.id} href={`/my-animals/${encodeURIComponent(a.id)}`} data-testid="home-animal-row" className="flex items-center gap-3 min-h-11 py-2 group">
                                <span className="w-10 h-10 shrink-0 rounded-lg bg-stone-200 overflow-hidden flex items-center justify-center">
                                    {a.photo
                                        ? <img src={a.photo} alt="" className="w-full h-full object-cover" />
                                        : <img src={`/placeholders/${a.species === 'cat' ? 'cat' : a.species === 'dog' ? 'dog' : 'paw'}.png`} alt="" className="w-7 h-7 object-contain opacity-60" />}
                                </span>
                                <span className="flex-1 min-w-0">
                                    <span className="block text-sm font-semibold text-stone-900 group-hover:text-teal-700 [overflow-wrap:anywhere]">{a.name || t('homeModules.unnamed_animal')}</span>
                                    <span className="block text-xs text-stone-500 [overflow-wrap:anywhere]">{status(a)}</span>
                                </span>
                            </Link>
                        ))}
                    </div>
                    {d.available > Math.min(d.listed.length, homeListLimit(dueRows.length > 0)) && (
                        <MoreRow href="/my-animals" testId="home-animals-more" label={interpolate(t('homeModules.see_available'), { n: d.available })} />
                    )}
                </div>
            )}
            {dueRows.length === 0 && (
                <Link href="/my-animals/new" className="btn btn-standard btn-secondary w-full">{t('homeModules.add_animal')}</Link>
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
        <section data-testid="home-first-steps" className="bg-white rounded-2xl border border-stone-200 px-4 pt-2 pb-1 shadow-sm">
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

    useEffect(() => {
        let active = true;
        getHomeModules()
            .then(d => { if (active) setData(d); })
            .catch((e: unknown) => {
                if (!active) return;
                // An older tab: the page reloads itself; meanwhile show nothing rather than a skeleton forever.
                if (handledAsStale(e)) { setData(null); return; }
                setFailedId(resolveErrorId(e, 'HomeModules'));
            });
        return () => { active = false; };
    }, []);

    // Same compact wording as /my-adopters' «Creado por … hace 4 sem».
    const rel = (ms: number) => timeAgo(new Date(ms), locale !== 'en');

    if (failedId) {
        return (
            <section data-testid="home-modules-error" className="bg-white rounded-2xl border border-stone-200 p-4 shadow-sm">
                <SectionError errorId={failedId} t={t} />
            </section>
        );
    }
    // Space held while loading so the page below doesn't jump when the cards arrive.
    if (data === undefined) return <div data-testid="home-modules-loading" aria-hidden="true" className="h-48 rounded-2xl bg-white border border-stone-200 shadow-sm animate-pulse" />;
    if (data === null) return null;

    const now = Date.now();
    const posts = data.posts && data.posts.ok && !postsCardLive(data.posts.data.lastPostAt, now, HOME_POSTS_WINDOW_DAYS)
        ? ({ ok: true, data: { ...data.posts.data, people: 0, recent: [] } } as HomeSection<HomePostsData>)
        : data.posts;
    const { cards, steps, firstSteps } = orderHomeModules({
        adopters: stateOf(data.adopters, d => d.pendingReview > 0 || d.formsToReview > 0, d => d.total > 0),
        animals: stateOf(data.animals, d => d.due.length > 0, d => d.available + d.adopted > 0),
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


    const card = (k: HomeModuleKey) => {
        if (k === 'adopters') return <AdoptersCard key={k} section={data.adopters} contacts={contacts} t={t} rel={rel} />;
        if (k === 'animals' && data.animals) return <AnimalsCard key={k} section={data.animals} t={t} />;
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

    // Desktop: two columns inside the page's own width, read left to right,
    // each card keeping its own height. A lone card stays full width rather
    // than leaving an empty column beside it. Phones: one column.
    return (
        <div data-testid="home-modules" className={items.length > 1 ? 'grid gap-4 md:grid-cols-2 items-start' : 'space-y-4'}>
            {items}
        </div>
    );
}
