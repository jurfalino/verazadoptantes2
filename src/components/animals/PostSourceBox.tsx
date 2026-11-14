'use client';

/**
 * «¿Ya lo publicaste? Cargalo desde el post» — the top of «Agregar animal»
 * (Jon 2026-11-14). Paste a link (or upload screenshots), the post is fetched
 * and read by the AI, and the page fills the form. Every failure keeps the
 * link and leaves the form usable: there is no dead end.
 *
 * Kept OUTSIDE the page's <form>: tests and keyboards take «the first input of
 * the form» to be the animal's name.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import { buttonClasses } from '@/components/ui/Button';
import { WarningIcon, SparkIcon } from '@/components/ui/Glyph';
import { fetchPostForImport } from '@/lib/postFetch';
import { compressImage } from '@/lib/imageCompress';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { photoFromBase64, type PostPhoto } from '@/components/animals/importSave';
import { normalizePostLink, type AnimalExtraction } from '@/domain/animalImport';
import { useShowToast } from '@/components/ui/Toast';

export interface PostReadResult {
    /** The post's own link ('' for screenshots), saved on the animal. */
    sourceUrl: string;
    /** The link as pasted, when the fetcher resolved it to another (a /share/ link). */
    linkAsGiven: string | null;
    photos: PostPhoto[];
    extraction: AnimalExtraction;
    from: 'link' | 'screens';
}

type Phase =
    | { kind: 'idle' }
    | { kind: 'reading' }
    | { kind: 'read'; from: 'link' | 'screens'; host: string }
    | { kind: 'failed'; why: 'unreadable' | 'error' | 'ai' | 'bad_link'; errorId?: string }
    | { kind: 'no_animal' };

const LinkIcon = ({ className = 'w-4 h-4' }: { className?: string }) => (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden>
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
);
const Spinner = () => (
    <svg className="w-5 h-5 animate-spin motion-reduce:hidden" viewBox="0 0 24 24" fill="none" aria-hidden><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.3" /><path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>
);

export function hostLabel(url: string): string {
    try {
        const h = new URL(url).hostname.replace(/^(www|m|web)\./, '');
        if (/(^|\.)instagram\.com$/.test(h)) return 'Instagram';
        if (/(^|\.)(facebook\.com|fb\.com)$/.test(h)) return 'Facebook';
        return h;
    } catch { return url; }
}

export default function PostSourceBox({ start, onRead, onSourceOnly, onReset, dateLabel }: {
    /** Arrived from the phone's share sheet: read at once. */
    start?: { url: string; text: string; images: Array<{ data: string; mimeType: string }> } | null;
    onRead: (r: PostReadResult) => void;
    /** The post could not be used, but its link should still be saved with a hand-filled animal. */
    onSourceOnly: (sourceUrl: string) => void;
    /** «Cambiar»: back to an empty box; the page drops what the post filled. */
    onReset: () => void;
    /** «12 ago» when the post's date is known. */
    dateLabel?: string | null;
}) {
    const { t, locale } = useLanguage();
    const toast = useShowToast();
    const [url, setUrl] = useState(start?.url ?? '');
    const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
    const lastInput = useRef<{ url: string; text: string; images: Array<{ data: string; mimeType: string }> } | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    const read = async (input: { url: string; text: string; images: Array<{ data: string; mimeType: string }> }) => {
        lastInput.current = input;
        // Only a real http(s) link is fetched or saved: «instagram.com/p/…» gets its https.
        const link = normalizePostLink(input.url);
        if (input.url.trim() && !link) {
            onSourceOnly('');
            setPhase({ kind: 'failed', why: 'bad_link' });
            return;
        }
        if (link && link !== input.url.trim()) setUrl(link);
        setPhase({ kind: 'reading' });
        try {
            let text = input.text;
            let imageUrls: string[] = [];
            let sourceUrl = link;
            const uploads = [...input.images];
            if (link) {
                const fetched = await fetchPostForImport(link);
                sourceUrl = fetched.resolvedUrl || link;
                if (!fetched.ok) {
                    onSourceOnly(sourceUrl);
                    setPhase({ kind: 'failed', why: fetched.kind, errorId: resolveErrorId(new Error(`animal import: post not fetched (${fetched.kind}): ${fetched.message ?? ''}`), 'PostSourceBox.fetch') });
                    return;
                }
                text = [fetched.text, input.text].filter(s => s.trim()).join('\n\n');
                for (const img of fetched.images) {
                    const m = /^data:([^;]+);base64,(.*)$/.exec(img);
                    if (m) uploads.push({ mimeType: m[1], data: m[2] });
                    else imageUrls.push(img);
                }
                imageUrls = imageUrls.filter(u => /^https:\/\//i.test(u));
            }
            const res = await fetch('/api/ai/extract-animals', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, images: uploads, imageUrls, language: locale }),
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const body: any = await res.json().catch(() => ({}));
            if (!res.ok || !body?.success) {
                if (sourceUrl) onSourceOnly(sourceUrl);
                setPhase({ kind: 'failed', why: 'ai', errorId: body?.errorId || resolveErrorId(new Error(`animal import: extraction failed (${res.status})`), 'PostSourceBox.extract') });
                return;
            }
            const extraction = body.data as AnimalExtraction;
            const photos: PostPhoto[] = (body.processedImages ?? []).map((p: { data: string; mimeType: string }) => photoFromBase64(p.data, p.mimeType));
            if (extraction.animals.length === 0) {
                // Not an adoption post (a report about a person…): its link must not end up on a hand-filled animal.
                onSourceOnly('');
                setPhase({ kind: 'no_animal' });
                return;
            }
            const from = link ? 'link' : 'screens';
            setPhase({ kind: 'read', from, host: link ? hostLabel(sourceUrl) : '' });
            onRead({ sourceUrl, linkAsGiven: sourceUrl !== link && link ? link : null, photos, extraction, from });
        } catch (e) {
            if (link) onSourceOnly(link);
            setPhase({ kind: 'failed', why: 'error', errorId: resolveErrorId(e, 'PostSourceBox.read') });
        }
    };

    // From the phone's share sheet: read once, as soon as the page is up.
    const started = useRef(false);
    useEffect(() => {
        if (!start || started.current) return;
        started.current = true;
        setUrl(start.url);
        void read(start);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [start]);

    const onScreens = async (files: FileList | null) => {
        if (!files || files.length === 0) return;
        const images: Array<{ data: string; mimeType: string }> = [];
        let lost = 0;
        let lostId: string | undefined;
        for (const f of Array.from(files).slice(0, 12)) {
            if (!f.type.startsWith('image/')) continue;
            try {
                const dataUrl = await compressImage(f);
                images.push({ data: dataUrl.split(',')[1] ?? '', mimeType: 'image/jpeg' });
            } catch (e) {
                lost++;
                lostId = resolveErrorId(e, 'PostSourceBox.screens');
            }
        }
        if (lost > 0) toast.error(t('errors.generic'), t('animalImport.photos_not_saved').replace('{n}', String(lost)), lostId);
        if (fileRef.current) fileRef.current.value = '';
        if (images.length) void read({ url: '', text: '', images });
    };

    const reset = () => { setPhase({ kind: 'idle' }); setUrl(''); onReset(); };

    if (phase.kind === 'read') {
        return (
            <div data-testid="post-source" data-state="read" className="mb-4">
                <div className="flex items-center gap-3 px-4 py-3 min-h-11 rounded-xl bg-teal-50 border border-teal-200 text-sm text-teal-800">
                    <LinkIcon className="w-4 h-4 shrink-0" />
                    <span className="flex-1 min-w-0 truncate">
                        <span className="font-semibold">
                            {phase.from === 'link' ? t('animalImport.source_post').replace('{host}', phase.host) : t('animalImport.source_screens')}
                        </span>
                        {dateLabel && <span className="text-teal-700"> · {dateLabel}</span>}
                    </span>
                    <button type="button" onClick={reset} data-testid="post-source-change" className="min-h-[44px] -my-2 px-2 -mr-2 text-xs font-bold text-teal-700 hover:text-teal-900">
                        {t('animalImport.change')}
                    </button>
                </div>
            </div>
        );
    }

    const reading = phase.kind === 'reading';
    return (
        <div data-testid="post-source" data-state={phase.kind} className="mb-4 bg-white rounded-2xl border border-stone-200 p-4 space-y-3">
            <div>
                <label htmlFor="post-source-url" className="block text-sm font-semibold text-stone-900">{t('animalImport.box_title')}</label>
                <p className="text-xs text-stone-500 mt-0.5">{t('animalImport.box_hint')}</p>
            </div>
            {/* Not a <form>: see the header. Enter reads, like a submit would. */}
            <div className="flex gap-2">
                <input
                    id="post-source-url"
                    aria-label={t('animalImport.url_label')}
                    value={url}
                    onChange={e => {
                        setUrl(e.target.value);
                        // A new link: the failed one is no longer what this animal came from.
                        if (phase.kind === 'failed' || phase.kind === 'no_animal') { setPhase({ kind: 'idle' }); onSourceOnly(''); }
                    }}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (url.trim() && !reading) void read({ url, text: '', images: [] }); } }}
                    inputMode="url"
                    autoComplete="off"
                    placeholder={t('animalImport.url_placeholder')}
                    disabled={reading}
                    className="flex-1 min-w-0 h-11 px-4 border border-stone-300 rounded-xl outline-none focus:border-teal-400 focus:ring-4 focus:ring-teal-100 text-base disabled:bg-stone-50 disabled:text-stone-500"
                />
                <button type="button" onClick={() => void read({ url, text: '', images: [] })} data-testid="post-source-read" disabled={!url.trim() || reading} className={buttonClasses({ size: 'compact' })}>
                    {reading ? <><Spinner />{t('animalImport.reading')}</> : <><SparkIcon className="w-4 h-4 shrink-0" />{t('animalImport.read')}</>}
                </button>
            </div>
            {reading && <p className="text-xs text-stone-500" aria-live="polite">{t('animalImport.reading_hint')}</p>}
            {phase.kind === 'idle' && (
                <p className="text-xs text-stone-500">
                    {t('animalImport.no_link')}{' '}
                    <button type="button" onClick={() => fileRef.current?.click()} className="font-semibold text-teal-700 underline underline-offset-2 min-h-[44px] -my-3">
                        {t('animalImport.upload_screens')}
                    </button>
                </p>
            )}
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" data-testid="post-source-screens" onChange={e => void onScreens(e.target.files)} />

            {phase.kind === 'failed' && (
                <div data-testid="post-source-failed" className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-sm" role="alert">
                    <div className="flex items-start gap-3">
                        <WarningIcon className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                            <p className="text-rose-700 font-medium">{t(phase.why === 'unreadable' ? 'animalImport.fail' : phase.why === 'bad_link' ? 'animalImport.bad_link' : 'animalImport.fail_ai')}</p>
                            {phase.errorId && <p className="text-xs text-rose-600 mt-1 font-mono select-all">Error ID: {phase.errorId}</p>}
                            <div className="flex flex-wrap gap-2 mt-3">
                                {phase.why !== 'bad_link' && (
                                    <button type="button" onClick={() => lastInput.current && void read(lastInput.current)} className="min-h-[44px] px-4 bg-rose-600 text-white rounded-xl text-sm font-bold hover:bg-rose-700">
                                        {t('animalImport.retry')}
                                    </button>
                                )}
                                <button type="button" onClick={() => fileRef.current?.click()} className="min-h-[44px] px-4 border border-rose-200 bg-white text-rose-700 rounded-xl text-sm font-bold">
                                    {t('animalImport.upload_screens')}
                                </button>
                            </div>
                            <p className="text-xs text-rose-700 mt-2">{t('animalImport.fail_by_hand')}</p>
                        </div>
                    </div>
                </div>
            )}

            {phase.kind === 'no_animal' && (
                <div data-testid="post-source-no-animal" className="p-3 rounded-xl text-sm border" style={{ background: 'var(--status-warning-bg)', borderColor: 'var(--status-warning-border)', color: 'var(--status-warning-text)' }}>
                    <p className="font-semibold">{t('animalImport.no_animal_title')}</p>
                    <p className="text-xs mt-1">{t('animalImport.no_animal_hint')}</p>
                    <div className="flex flex-wrap gap-2 mt-3">
                        {normalizePostLink(url) && (
                            <Link href={`/import?shared=true&shared_url=${encodeURIComponent(normalizePostLink(url))}&kind=person`} className={buttonClasses({ variant: 'secondary', size: 'compact' })}>
                                {t('animalImport.as_person')}
                            </Link>
                        )}
                        <button type="button" onClick={() => setPhase({ kind: 'idle' })} className="min-h-[44px] px-3 text-[13px] font-bold underline underline-offset-2">
                            {t('animalImport.by_hand')}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
