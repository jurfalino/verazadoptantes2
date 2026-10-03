import { useEffect, useMemo, useState } from 'react'
import { PawIcon, AlertIcon } from './components/Icons'
import { useT } from './i18n/LocaleContext'
import { speciesLabel, sexLabel, ageLabelMs, isFemale } from './lib/animalLabels'

const API_URL = import.meta.env.VITE_API_URL || ''

interface ApiImage {
    id: string
    url: string
    caption: string | null
    /** 'image' | 'video'. A rescuer can attach either, and a video dropped
     *  into an <img> is a broken frame on the family's page. */
    mediaType: string | null
    thumbnailUrl: string | null
}

interface ApiEvent {
    id: string
    eventType: string
    date: number | null
    details: string | null
    images: ApiImage[]
}

interface ApiResponse {
    animal: {
        id: string
        name: string | null
        species: string | null
        sex: string | null
        color: string | null
        age: string | null
        estimatedBirthDate: number | null
        neutered: number | null
        images: ApiImage[]
    }
    events: ApiEvent[]
    rescuer: { displayName: string; orgName?: string }
    recordedUpTo: number | null
}

/** One photo as the viewer meets it: never bare, always carrying the entry it
 *  came from. A photo without its date and its visit is a loose picture six
 *  months later, which is the whole failure this page exists to avoid. */
interface Shot {
    url: string
    caption: string
    event: string
    isVideo: boolean
    poster: string | null
}

/** Rail colours per clinical event type. Each is ≥4.5:1 on white, and they
 *  differ in lightness as well as hue so the rail reads without colour. */
const EVENT_COLOR: Record<string, string> = {
    vaccination: '#047857',
    deworming: '#3f6212',
    vet_visit: '#0e7490',
    neuter: '#a21caf',
}

/** A still, or a video's poster with a play badge over it. Nothing autoplays
 *  in a grid — a video plays full size, in the lightbox. A video with no
 *  poster falls back to a neutral tile rather than a broken frame. */
function Thumb({ img, className, alt }: { img: ApiImage; className: string; alt?: string }) {
    const isVideo = img.mediaType === 'video'
    const src = isVideo ? img.thumbnailUrl : img.url
    return (
        <span className="relative block">
            {src ? (
                <img src={src} alt={alt ?? img.caption ?? ''} className={className} />
            ) : (
                <span className={`${className} flex items-center justify-center bg-stone-300 text-stone-600`}>
                    <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m10 9 5 3-5 3z" /></svg>
                </span>
            )}
            {isVideo && (
                <span className="absolute inset-0 flex items-center justify-center" aria-hidden>
                    <span className="flex items-center justify-center w-11 h-11 rounded-full bg-black/60">
                        <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M8 5v14l11-7z" /></svg>
                    </span>
                </span>
            )}
        </span>
    )
}

function setMetaTag(name: string, content: string, attr: 'name' | 'property' = 'name') {
    let tag = document.querySelector(`meta[${attr}="${name}"]`)
    if (!tag) {
        tag = document.createElement('meta')
        tag.setAttribute(attr, name)
        document.head.appendChild(tag)
    }
    tag.setAttribute('content', content)
}

/**
 * HealthRecord — /salud/:id, the page a rescuer hands to the family.
 *
 * It is the animal's clinical timeline and nothing else: no foster home, no
 * adopter, no rating, no follow-up. That is enforced by the API, which never
 * reads those tables at all; this component simply has nothing else to render.
 *
 * It states no clinical conclusion either — no "vaccines up to date", no next
 * dose. The app does not know what this species at this age is due for, so
 * every date on the page is one somebody recorded, and the footer says so and
 * points at the reader's own vet.
 */
export default function HealthRecord({ animalId }: { animalId: string }) {
    const { t, locale } = useT()
    const [data, setData] = useState<ApiResponse | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    /** 'page' | 'gallery' is where the viewer is; `shot` is the open photo (an
     *  index into `shots`), and `back` remembers whether closing it returns to
     *  the grid or the timeline. */
    const [view, setView] = useState<'page' | 'gallery'>('page')
    const [shot, setShot] = useState<number | null>(null)
    const [back, setBack] = useState<'page' | 'gallery'>('page')

    useEffect(() => {
        let cancelled = false
        async function load() {
            setLoading(true)
            setError(null)
            try {
                const res = await fetch(`${API_URL}/api/showcase/health/${encodeURIComponent(animalId)}`)
                if (cancelled) return
                if (!res.ok) {
                    setError(res.status === 404 ? t('health.not_found_title') : t('common.network_error'))
                    return
                }
                setData(await res.json() as ApiResponse)
            } catch {
                if (!cancelled) setError(t('common.network_error'))
            } finally {
                if (!cancelled) setLoading(false)
            }
        }
        load()
        return () => { cancelled = true }
    }, [animalId, t])

    const fmtDate = useMemo(() => {
        const f = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' })
        return (ms: number | null) => (ms ? f.format(new Date(ms)) : '')
    }, [locale])

    const name = data?.animal.name?.trim() || t('health.unnamed')
    const eventLabel = (type: string) => t(`health.event_${type}`)

    // The cover photo first, then every event's photos in timeline order, so
    // stepping through the lightbox walks the animal's life the same way the
    // page does.
    const shots: Shot[] = useMemo(() => {
        if (!data) return []
        const out: Shot[] = []
        const shot = (img: ApiImage, caption: string, event: string): Shot => ({
            url: img.url,
            caption,
            event,
            isVideo: img.mediaType === 'video',
            poster: img.thumbnailUrl || null,
        })
        for (const img of data.animal.images) {
            out.push(shot(img, img.caption || name, ''))
        }
        for (const ev of data.events) {
            const when = `${eventLabel(ev.eventType)} · ${fmtDate(ev.date)}`
            for (const img of ev.images) {
                out.push(shot(img, img.caption || t('health.no_caption'), when))
            }
        }
        return out
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data, fmtDate, name, t])

    // Photos arrive in `shots` order, but each event renders its own; this maps
    // an event's Nth photo back to its position in the flat list.
    const shotIndex = useMemo(() => {
        const map = new Map<string, number>()
        if (!data) return map
        let i = 0
        for (const img of data.animal.images) map.set(img.id, i++)
        for (const ev of data.events) for (const img of ev.images) map.set(img.id, i++)
        return map
    }, [data])

    const openShot = (imageId: string, from: 'page' | 'gallery') => {
        const i = shotIndex.get(imageId)
        if (i === undefined) return
        setBack(from)
        setShot(i)
    }

    // Esc closes the open photo, then the grid — the reflex on any lightbox.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return
            if (shot !== null) setShot(null)
            else if (view === 'gallery') setView('page')
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
    }, [shot, view])

    useEffect(() => {
        if (!data) return
        document.title = t('health.doc_title', { name })
        setMetaTag('description', t('health.meta_description', { name }))
        // Handed to one family, not published: reachable by link, absent from
        // search. The API sends X-Robots-Tag; this covers the rendered page.
        setMetaTag('robots', 'noindex, nofollow')
    }, [data, name, t])

    if (loading) {
        return <main className="ps-showcase-page"><div className="ps-showcase-loading">{t('common.loading')}</div></main>
    }

    if (error || !data) {
        return (
            <main className="ps-showcase-page">
                <div className="ps-showcase-empty">
                    <div className="ps-showcase-empty__icon" aria-hidden>
                        <AlertIcon size={48} />
                    </div>
                    <h1 className="ps-showcase-empty__title">{error || t('health.not_found_title')}</h1>
                    <p className="ps-showcase-empty__desc">{t('health.not_found_body')}</p>
                </div>
            </main>
        )
    }

    const a = data.animal
    const fem = isFemale(a.sex)
    const castration = a.neutered === 1
        ? t(fem ? 'health.castrated_f' : 'health.castrated_m')
        : a.neutered === 0
            ? t(fem ? 'health.not_castrated_f' : 'health.not_castrated_m')
            : null
    const descriptor = [
        [speciesLabel(a.species, t), a.color?.toLowerCase()].filter(Boolean).join(' '),
        sexLabel(a.sex, t),
        ageLabelMs(a.estimatedBirthDate, a.age, t),
        castration,
    ].filter(Boolean).join(' · ')

    const cover = a.images[0]
    const rescuerName = data.rescuer.orgName || data.rescuer.displayName
    const photosLabel = shots.length === 1
        ? t('health.photos_one')
        : t('health.photos_many', { n: shots.length })
    const disclaimer = data.recordedUpTo
        ? t('health.disclaimer', { rescuer: rescuerName, date: fmtDate(data.recordedUpTo), name })
        : t('health.disclaimer_nodate', { rescuer: rescuerName, name })

    return (
        <main className="min-h-screen bg-stone-200">
            <div className="mx-auto w-full max-w-2xl bg-stone-100 min-h-screen">

                {/* cover */}
                <div className="relative">
                    {cover ? (
                        <button
                            type="button"
                            onClick={() => openShot(cover.id, 'page')}
                            aria-label={t('health.open_cover', { name })}
                            className="block w-full cursor-zoom-in"
                            data-testid="health-cover"
                        >
                            <Thumb img={cover} alt={cover.caption || name} className="block w-full h-60 sm:h-80 object-cover" />
                        </button>
                    ) : (
                        <div className="w-full h-40 bg-stone-300 flex items-center justify-center text-stone-500" aria-hidden>
                            <PawIcon size={64} />
                        </div>
                    )}

                    <div className="absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-black/80 to-transparent pointer-events-none">
                        <h1 className="text-2xl font-extrabold text-white tracking-tight" data-testid="health-name">{name}</h1>
                        {descriptor && <p className="mt-0.5 text-sm font-semibold text-stone-100">{descriptor}</p>}
                    </div>

                    {shots.length > 0 && (
                        <button
                            type="button"
                            onClick={() => setView('gallery')}
                            className="absolute right-3 top-3 inline-flex items-center gap-1.5 min-h-11 px-3.5 py-2 rounded-xl bg-black/60 text-white text-[13px] font-bold hover:bg-black/75 transition-colors"
                            data-testid="health-open-gallery"
                        >
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8.5" cy="10" r="1.5" /><path d="m21 15-5-5L5 19" /></svg>
                            {photosLabel}
                        </button>
                    )}
                </div>

                <div className="p-4 flex flex-col gap-4">
                    {/* No free-text description: see the route's note — it can
                        name the family, and the descriptor above is built from
                        structured fields that cannot. */}
                    <h2 className="text-xs font-bold uppercase tracking-[0.05em] text-teal-700">
                        {t('health.recorded_heading')}
                    </h2>

                    {/* the rail */}
                    <ol className="relative pl-6 list-none m-0 flex flex-col gap-4">
                        <span className="absolute left-[7px] top-2.5 bottom-2.5 w-0.5 bg-stone-300" aria-hidden />
                        {data.events.map(ev => {
                            const color = EVENT_COLOR[ev.eventType] || '#57534e'
                            return (
                                <li key={ev.id} className="relative bg-white border border-stone-300 rounded-2xl p-3.5" data-testid="health-event">
                                    <span
                                        className="absolute -left-6 top-4 w-4 h-4 rounded-full border-[3px] border-stone-100"
                                        style={{ background: color }}
                                        aria-hidden
                                    />
                                    <div className="flex items-baseline justify-between gap-2">
                                        <h3 className="m-0 text-sm font-bold" style={{ color }}>{eventLabel(ev.eventType)}</h3>
                                        <span className="text-[11px] font-semibold text-stone-600 whitespace-nowrap">{fmtDate(ev.date)}</span>
                                    </div>
                                    {ev.details && <p className="mt-1 text-[13px] text-stone-700 leading-relaxed">{ev.details}</p>}
                                    {ev.images.length > 0 && (
                                        <div className={`mt-2 grid gap-2 ${ev.images.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                                            {ev.images.map(img => (
                                                <button
                                                    key={img.id}
                                                    type="button"
                                                    onClick={() => openShot(img.id, 'page')}
                                                    aria-label={t('health.open_photo', { caption: img.caption || t('health.no_caption') })}
                                                    className="block rounded-xl overflow-hidden bg-stone-200 cursor-zoom-in"
                                                    data-testid="health-event-photo"
                                                >
                                                    <Thumb
                                                        img={img}
                                                        className={`block w-full object-cover ${ev.images.length === 1 ? 'h-44' : 'h-28'}`}
                                                    />
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                    {ev.images.length === 1 && ev.images[0].caption && (
                                        <p className="mt-1.5 text-[11px] font-medium text-stone-600">{ev.images[0].caption}</p>
                                    )}
                                </li>
                            )
                        })}
                    </ol>

                    <div className="bg-stone-200 border border-stone-300 rounded-xl p-3">
                        <p className="m-0 text-[11px] text-stone-700 leading-relaxed" data-testid="health-disclaimer">{disclaimer}</p>
                    </div>
                </div>
            </div>

            {/* every photo in one place */}
            {view === 'gallery' && (
                <div className="fixed inset-0 z-40 bg-stone-100 overflow-y-auto" role="dialog" aria-modal="true" aria-label={t('health.gallery_title', { name })}>
                    <div className="sticky top-0 flex items-center gap-3 px-4 py-3 bg-white border-b border-stone-300">
                        <button
                            type="button"
                            onClick={() => setView('page')}
                            aria-label={t('health.back')}
                            className="inline-flex items-center justify-center w-11 h-11 -ml-2.5 rounded-xl text-stone-900 hover:bg-stone-100 transition-colors"
                            data-testid="health-gallery-back"
                        >
                            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m15 18-6-6 6-6" /></svg>
                        </button>
                        <h2 className="m-0 text-base font-extrabold text-stone-900 tracking-tight">
                            {shots.length === 1 ? t('health.gallery_title_one', { name }) : t('health.gallery_title', { name })}
                        </h2>
                    </div>
                    <div className="mx-auto w-full max-w-2xl p-4 grid grid-cols-2 gap-2">
                        {data.animal.images.concat(data.events.flatMap(e => e.images)).map(img => (
                            <button
                                key={img.id}
                                type="button"
                                onClick={() => openShot(img.id, 'gallery')}
                                aria-label={t('health.open_photo', { caption: img.caption || t('health.no_caption') })}
                                className="text-left rounded-xl overflow-hidden bg-stone-200 cursor-zoom-in"
                                data-testid="health-gallery-photo"
                            >
                                <Thumb img={img} className="block w-full h-32 object-cover" />
                                {img.caption && (
                                    <span className="block px-2 pt-1.5 pb-2 bg-white text-[11px] font-semibold text-stone-700 leading-snug">{img.caption}</span>
                                )}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* one photo, full size */}
            {shot !== null && shots[shot] && (
                <div className="fixed inset-0 z-50 bg-stone-950 flex flex-col" role="dialog" aria-modal="true" aria-label={shots[shot].caption}>
                    <div className="flex items-center justify-between gap-3 px-4 py-3">
                        <span className="text-[13px] font-bold text-stone-200" data-testid="health-photo-pos">
                            {t('health.photo_pos', { i: shot + 1, n: shots.length })}
                        </span>
                        <button
                            type="button"
                            onClick={() => { setShot(null); setView(back) }}
                            aria-label={t('health.close_photo')}
                            className="inline-flex items-center justify-center w-11 h-11 -mr-2.5 rounded-xl text-stone-200 hover:bg-white/10 transition-colors"
                            data-testid="health-photo-close"
                        >
                            <svg className="w-5.5 h-5.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>
                        </button>
                    </div>
                    <div className="flex-1 min-h-0 flex items-center justify-center px-2">
                        {shots[shot].isVideo ? (
                            <video
                                src={shots[shot].url}
                                poster={shots[shot].poster ?? undefined}
                                controls
                                playsInline
                                className="max-w-full max-h-full"
                                data-testid="health-photo-full"
                            />
                        ) : (
                            <img src={shots[shot].url} alt={shots[shot].caption} className="max-w-full max-h-full object-contain" data-testid="health-photo-full" />
                        )}
                    </div>
                    <div className="p-4 mx-auto w-full max-w-2xl">
                        <p className="m-0 text-sm font-bold text-white leading-snug">{shots[shot].caption}</p>
                        {shots[shot].event && <p className="mt-0.5 text-xs text-stone-400">{shots[shot].event}</p>}
                        {shots.length > 1 && (
                            <div className="mt-3 flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => setShot((shot - 1 + shots.length) % shots.length)}
                                    className="flex-1 min-h-11 rounded-xl border border-stone-700 text-[13px] font-bold text-stone-200 hover:bg-white/10 transition-colors"
                                    data-testid="health-photo-prev"
                                >{t('health.prev')}</button>
                                <button
                                    type="button"
                                    onClick={() => setShot((shot + 1) % shots.length)}
                                    className="flex-1 min-h-11 rounded-xl border border-stone-700 text-[13px] font-bold text-stone-200 hover:bg-white/10 transition-colors"
                                    data-testid="health-photo-next"
                                >{t('health.next')}</button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </main>
    )
}
