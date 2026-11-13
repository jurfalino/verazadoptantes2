'use client';

/**
 * «Personalizar» on a group card (/organizations): the group's logo, cover,
 * social links, background and accent, with a live preview of the public header.
 * Spec: docs/superpowers/specs/2026-11-13-group-branding-design.md.
 *
 * Mounted only when ENABLE_GROUP_BRANDING is on. Nothing is requested until the
 * row is opened. Images upload as soon as they are picked (setGroupImage); the
 * rest is saved with «Guardar» (saveGroupBranding), which refuses a bad link
 * with the field named — shown under that field.
 */

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type CSSProperties } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import { useDateFormat } from '@/context/TimezoneContext';
import { useShowToast } from '@/components/ui/Toast';
import { reportClientError, resolveErrorId } from '@/lib/clientErrorReporter';
import { handledAsStale } from '@/lib/errorMessage';
import { compressImage, IMAGE_DECODE_FAILED } from '@/lib/imageCompress';
import { getGroupBranding, saveGroupBranding, setGroupImage, type GroupBrandingView } from '@/app/actions/groupBranding';
import {
    ACCENTS, BANNER_MAX_PX, LOGO_MAX_PX, ORG_IMAGE_MAX_DATA_URL,
    type AccentId, type GroupTheme, type OrgImageKind, type SocialKind,
} from '@/domain/groupBranding';
import GroupBrandingPreview, {
    InstagramIcon, FacebookIcon, WebIcon, PUBLIC_THEME_TOKENS, accentShade, brandingImageSrc, type PreviewLink,
} from '@/components/GroupBrandingPreview';

const SOURCE = 'GroupBrandingSection';
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
// Next's server-action body limit is 1 MB: step the JPEG quality down until the data URL fits.
const QUALITY_STEPS = [0.8, 0.65, 0.5];
const SOCIAL_KINDS: SocialKind[] = ['instagram', 'facebook', 'website'];
const SOCIAL_ICONS: Record<SocialKind, PreviewLink['Icon']> = { instagram: InstagramIcon, facebook: FacebookIcon, website: WebIcon };

type Form = { theme: GroupTheme; accentId: AccentId; instagram: string; facebook: string; website: string };
type Status = 'loading' | 'ready' | 'error' | 'forbidden' | 'disabled';
type Refusal = { error?: string; errorId?: string };

const formFrom = (d: GroupBrandingView): Form => ({
    theme: d.theme, accentId: d.accentId,
    instagram: d.instagramUrl ?? '', facebook: d.facebookUrl ?? '', website: d.websiteUrl ?? '',
});

const CameraBadge = () => (
    <span className="pointer-events-none absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-white border border-stone-200 flex items-center justify-center shadow-sm text-stone-600" aria-hidden="true">
        <svg className="w-3 h-3" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7a1 1 0 0 1 1-1h2.5l1-1.5h5l1 1.5H16a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z" />
            <circle cx="10" cy="11" r="2.5" />
        </svg>
    </span>
);

const Spinner = ({ className = 'w-5 h-5' }: { className?: string }) => (
    <svg className={`${className} animate-spin`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.3" />
        <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
);

const CheckIcon = () => (
    <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 10.5l3.5 3.5L15 7" />
    </svg>
);

const sectionLabel = 'text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2';
const btnSecondary = 'inline-flex items-center gap-2 min-h-11 py-2 px-4 rounded-xl text-sm font-bold text-teal-700 bg-teal-50 border border-teal-200 hover:bg-teal-100 hover:border-teal-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
const btnDestructive = 'inline-flex items-center gap-2 min-h-11 py-2 px-4 rounded-xl text-sm font-bold text-rose-600 bg-rose-50 border border-rose-200 hover:bg-rose-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

export default function GroupBrandingSection({ orgId, orgName }: { orgId: string; orgName: string }) {
    const { t } = useLanguage();
    const { formatDateTime } = useDateFormat();
    const toast = useShowToast();

    const [open, setOpen] = useState(false);
    const [status, setStatus] = useState<Status>('loading');
    const [loadErrorId, setLoadErrorId] = useState<string | null>(null);
    const [data, setData] = useState<GroupBrandingView | null>(null);
    const [form, setForm] = useState<Form | null>(null);
    const [fieldError, setFieldError] = useState<SocialKind | null>(null);
    const [saving, setSaving] = useState(false);
    const [imageBusy, setImageBusy] = useState<OrgImageKind | null>(null);
    const [imageMsg, setImageMsg] = useState<{ kind: OrgImageKind; text: string } | null>(null);
    const requested = useRef(false);
    const logoInput = useRef<HTMLInputElement>(null);
    const bannerInput = useRef<HTMLInputElement>(null);
    const fieldRefs = useRef<Partial<Record<SocialKind, HTMLInputElement | null>>>({});

    const bodyId = `group-branding-body-${orgId}`;

    /** A refused or failed call → one toast with an error id (never raw server text). */
    const failToast = useCallback((res: Refusal | undefined, op: string) => {
        const errorId = res?.errorId || resolveErrorId(new Error(`${op}: ${res?.error ?? 'no result'}`), SOURCE);
        const text = res?.error === 'forbidden' ? t('groupBranding.forbidden')
            : res?.error === 'disabled' ? t('groupBranding.disabled')
            : t('groupBranding.save_failed');
        toast.error(t('errors.generic'), text, errorId);
    }, [t, toast]);

    const caughtToast = useCallback((e: unknown) => {
        if (!handledAsStale(e)) toast.error(t('errors.generic'), t('groupBranding.save_failed'), resolveErrorId(e, SOURCE));
    }, [t, toast]);

    /**
     * Reads the group's branding. `resetForm` false keeps what the user is typing (after an image
     * change). Only the first read owns the section's state: a later one that fails is reported and
     * leaves the form as it is — the change it follows already went through.
     */
    const load = useCallback(async (resetForm: boolean, initial = false) => {
        const fail = (errorId: string, refusal?: 'forbidden' | 'disabled') => {
            if (!initial) return;
            if (refusal) { setStatus(refusal); return; }
            setLoadErrorId(errorId);
            setStatus('error');
        };
        try {
            const res = await getGroupBranding(orgId);
            if (res.success && res.data) {
                const d = res.data;
                setData(d);
                if (resetForm) setForm(formFrom(d));
                setStatus('ready');
                return;
            }
            const refusal = res.error === 'forbidden' || res.error === 'disabled' ? res.error : undefined;
            fail(res.errorId || resolveErrorId(new Error(`getGroupBranding${initial ? '' : ' (refresh)'}: ${res.error}`), SOURCE), refusal);
        } catch (e) {
            fail(resolveErrorId(e, SOURCE));
        }
    }, [orgId]);

    useEffect(() => {
        if (!open || requested.current) return;
        requested.current = true;
        void load(true, true);
    }, [open, load]);

    const retry = () => { setStatus('loading'); setLoadErrorId(null); void load(true, true); };

    const setField = <K extends keyof Form>(key: K, value: Form[K]) => {
        setForm(f => (f ? { ...f, [key]: value } : f));
        if (fieldError === key) setFieldError(null);
    };

    const handleSave = async () => {
        if (!form) return;
        setSaving(true);
        try {
            const res = await saveGroupBranding(orgId, {
                theme: form.theme, accentId: form.accentId,
                instagram: form.instagram, facebook: form.facebook, website: form.website,
            });
            if (res.success) {
                setFieldError(null);
                toast.success(t('groupBranding.saved'));
                await load(true); // shows the links as stored (normalised) and who saved them
            } else if (res.error === 'invalid' && res.field && (SOCIAL_KINDS as string[]).includes(res.field)) {
                const field = res.field as SocialKind;
                setFieldError(field);
                fieldRefs.current[field]?.focus();
            } else {
                failToast(res, 'saveGroupBranding');
            }
        } catch (e) {
            caughtToast(e);
        } finally {
            setSaving(false);
        }
    };

    /** Shrinks the picked file in the browser until it fits the server-action body, then uploads it. */
    const handlePick = async (kind: OrgImageKind, e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = ''; // picking the same file again still fires
        if (!file) return;
        setImageMsg(null);
        if (!IMAGE_TYPES.includes(file.type)) { setImageMsg({ kind, text: t('groupBranding.image_type') }); return; }

        setImageBusy(kind);
        try {
            let dataUrl: string | null = null;
            try {
                for (const quality of QUALITY_STEPS) {
                    // White fill: JPEG has no transparency, and the public logo tile is white.
                    const candidate = await compressImage(file, kind === 'logo' ? LOGO_MAX_PX : BANNER_MAX_PX, quality, '#ffffff');
                    if (candidate.length <= ORG_IMAGE_MAX_DATA_URL) { dataUrl = candidate; break; }
                }
            } catch (err) {
                // Logged either way, with what was picked. A file the browser cannot decode (e.g. an HTML file
                // renamed .png) is the user's wrong file: say so inline. Anything else (no canvas, unreadable
                // file) is a fault: toast it with its id.
                const undecodable = err instanceof Error && err.message === IMAGE_DECODE_FAILED;
                const errorId = crypto.randomUUID().slice(0, 8);
                void reportClientError({
                    errorId,
                    message: `compressImage failed: ${err instanceof Error ? err.message : String(err)}`,
                    stack: err instanceof Error ? err.stack : undefined,
                    source: `${SOURCE}.compress`,
                    extra: { orgId, kind, fileType: file.type, fileSize: file.size },
                    level: undecodable ? 'warn' : 'error',
                });
                if (undecodable) setImageMsg({ kind, text: t('groupBranding.image_type') });
                else toast.error(t('errors.generic'), t('groupBranding.save_failed'), errorId);
                return;
            }
            if (!dataUrl) { setImageMsg({ kind, text: t('groupBranding.image_too_big') }); return; }

            const res = await setGroupImage(orgId, kind, dataUrl);
            if (res.success) {
                setData(d => (d ? { ...d, [kind === 'logo' ? 'logoUrl' : 'bannerUrl']: res.url ?? null } : d));
                toast.success(t(kind === 'logo' ? 'groupBranding.logo_saved' : 'groupBranding.banner_saved'));
                void load(false);
            } else if (res.error === 'invalid') {
                setImageMsg({ kind, text: t('groupBranding.image_type') });
            } else {
                failToast(res, 'setGroupImage');
            }
        } catch (err) {
            caughtToast(err);
        } finally {
            setImageBusy(null);
        }
    };

    const handleRemove = async (kind: OrgImageKind) => {
        setImageMsg(null);
        setImageBusy(kind);
        try {
            const res = await setGroupImage(orgId, kind, null);
            if (res.success) {
                setData(d => (d ? { ...d, [kind === 'logo' ? 'logoUrl' : 'bannerUrl']: null } : d));
                toast.success(t(kind === 'logo' ? 'groupBranding.logo_removed' : 'groupBranding.banner_removed'));
                void load(false);
            } else {
                failToast(res, 'setGroupImage(remove)');
            }
        } catch (e) {
            caughtToast(e);
        } finally {
            setImageBusy(null);
        }
    };

    const initials = orgName.split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
    const imageNote = (kind: OrgImageKind) => imageMsg?.kind === kind && (
        <p role="alert" data-testid={`group-branding-${kind}-error`} className="mt-2 text-xs font-medium text-rose-600">{imageMsg.text}</p>
    );

    const renderBody = () => {
        if (status === 'loading' || (status === 'ready' && !form)) {
            return <p className="text-sm text-stone-500">{t('common.loading')}</p>;
        }
        if (status === 'forbidden' || status === 'disabled') {
            return <p className="text-sm text-stone-500">{t(`groupBranding.${status}`)}</p>;
        }
        if (status === 'error' || !form || !data) {
            return (
                <div role="status" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-stone-600">
                    <span>{t('groupBranding.load_failed')}</span>
                    <button type="button" onClick={retry} className="min-h-11 px-2 font-semibold text-teal-700 underline underline-offset-2">
                        {t('groupBranding.retry')}
                    </button>
                    {loadErrorId && <span className="text-xs text-stone-500">#{loadErrorId}</span>}
                </div>
            );
        }

        const busy = imageBusy !== null;
        const previewLinks: PreviewLink[] = SOCIAL_KINDS
            .filter(k => form[k].trim())
            .map(k => ({ key: k, label: t(`groupBranding.${k}`), Icon: SOCIAL_ICONS[k] }));
        const onAccent = PUBLIC_THEME_TOKENS[form.theme].onAccent;

        return (
            <>
                <div className="space-y-2">
                    <p className="text-sm text-stone-500 max-w-prose">{t('groupBranding.intro')}</p>
                    <p className="text-sm text-stone-500 max-w-prose">
                        {t('groupBranding.used_when').replace('{choice}', t('adoptionDocs.use_group').replace('{name}', orgName))}
                    </p>
                    <Link href="/settings#adoption-docs" className="inline-flex items-center min-h-11 text-sm font-semibold text-teal-700 underline">
                        {t('groupBranding.see_settings')}
                    </Link>
                </div>

                <input ref={logoInput} type="file" accept={IMAGE_TYPES.join(',')} className="hidden" data-testid="group-branding-logo-input" onChange={e => handlePick('logo', e)} />
                <input ref={bannerInput} type="file" accept={IMAGE_TYPES.join(',')} className="hidden" data-testid="group-branding-banner-input" onChange={e => handlePick('banner', e)} />

                {/* Logo — the avatar affordance from AdopterForm (tile + camera badge). */}
                <div>
                    <h3 className={sectionLabel}>{t('groupBranding.logo')}</h3>
                    <div className="flex items-center gap-4">
                        <div className="relative flex-shrink-0">
                            <button
                                type="button"
                                onClick={() => logoInput.current?.click()}
                                disabled={busy}
                                aria-label={data.logoUrl ? t('groupBranding.logo_change') : t('groupBranding.logo_upload')}
                                title={data.logoUrl ? t('groupBranding.logo_change') : t('groupBranding.logo_upload')}
                                className="block rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 hover:opacity-90 cursor-pointer transition-opacity disabled:cursor-wait"
                            >
                                {data.logoUrl ? (
                                    <div className="relative w-16 h-16 rounded-xl bg-white overflow-hidden ring-2 ring-teal-200 shadow-sm">
                                        <img src={brandingImageSrc(data.logoUrl)} alt="" className="w-full h-full object-cover" />
                                        {imageBusy === 'logo' && (
                                            <span className="absolute inset-0 flex items-center justify-center bg-white/80 text-teal-700"><Spinner /></span>
                                        )}
                                    </div>
                                ) : (
                                    <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-teal-400 to-teal-500 flex items-center justify-center shadow-sm text-white">
                                        {imageBusy === 'logo' ? <Spinner /> : <span className="font-semibold text-lg">{initials || '?'}</span>}
                                    </div>
                                )}
                            </button>
                            {imageBusy !== 'logo' && <CameraBadge />}
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="text-sm text-stone-500 mb-2">{t('groupBranding.logo_hint')}</p>
                            <div className="flex flex-wrap gap-2">
                                <button type="button" onClick={() => logoInput.current?.click()} disabled={busy} className={btnSecondary} data-testid="group-branding-logo-change">
                                    {data.logoUrl ? t('groupBranding.change') : t('groupBranding.logo_upload')}
                                </button>
                                {data.logoUrl && (
                                    <button type="button" onClick={() => handleRemove('logo')} disabled={busy} className={btnDestructive} data-testid="group-branding-logo-remove">
                                        {t('groupBranding.remove')}
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                    {imageNote('logo')}
                </div>

                {/* Portada (3:1) */}
                <div>
                    <h3 className={sectionLabel}>
                        {t('groupBranding.banner')}{' '}
                        <span className="normal-case tracking-normal font-medium text-stone-400">· {t('groupBranding.optional')}</span>
                    </h3>
                    {data.bannerUrl ? (
                        <>
                            <div className="relative aspect-[3/1] rounded-xl overflow-hidden ring-2 ring-teal-200 shadow-sm bg-stone-100">
                                <img src={brandingImageSrc(data.bannerUrl)} alt="" className="w-full h-full object-cover" />
                                {imageBusy === 'banner' && (
                                    <span className="absolute inset-0 flex items-center justify-center bg-white/80 text-teal-700"><Spinner /></span>
                                )}
                            </div>
                            <p className="text-sm text-stone-500 mt-2 mb-2">{t('groupBranding.banner_hint')}</p>
                            <div className="flex flex-wrap gap-2">
                                <button type="button" onClick={() => bannerInput.current?.click()} disabled={busy} className={btnSecondary} data-testid="group-branding-banner-change">
                                    {t('groupBranding.change')}
                                </button>
                                <button type="button" onClick={() => handleRemove('banner')} disabled={busy} className={btnDestructive} data-testid="group-branding-banner-remove">
                                    {t('groupBranding.remove')}
                                </button>
                            </div>
                        </>
                    ) : (
                        <>
                            <button
                                type="button"
                                onClick={() => bannerInput.current?.click()}
                                disabled={busy}
                                data-testid="group-branding-banner-change"
                                className="aspect-[3/1] w-full flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-stone-300 bg-stone-50 text-stone-500 hover:border-teal-400 hover:text-teal-700 transition-colors disabled:cursor-wait"
                            >
                                {imageBusy === 'banner' ? <Spinner className="w-6 h-6" /> : (
                                    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                        <rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8.5" cy="10" r="1.5" /><path d="M21 15l-5-5L5 19" />
                                    </svg>
                                )}
                                <span className="text-sm font-bold">{imageBusy === 'banner' ? t('groupBranding.uploading') : t('groupBranding.banner_add')}</span>
                            </button>
                            <p className="text-sm text-stone-500 mt-2">{t('groupBranding.banner_hint_empty')}</p>
                        </>
                    )}
                    {imageNote('banner')}
                </div>

                {/* Redes y sitio web */}
                <div>
                    <h3 className={sectionLabel}>{t('groupBranding.links')}</h3>
                    <div className="space-y-3">
                        {SOCIAL_KINDS.map(kind => {
                            const Icon = SOCIAL_ICONS[kind];
                            const invalid = fieldError === kind;
                            const inputId = `group-branding-${kind}-${orgId}`;
                            return (
                                <div key={kind}>
                                    <label htmlFor={inputId} className="block text-sm font-medium text-stone-700 mb-1">{t(`groupBranding.${kind}`)}</label>
                                    <span className="relative block">
                                        <Icon className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
                                        <input
                                            id={inputId}
                                            ref={el => { fieldRefs.current[kind] = el; }}
                                            type="text"
                                            inputMode="url"
                                            autoCapitalize="none"
                                            autoCorrect="off"
                                            spellCheck={false}
                                            value={form[kind]}
                                            onChange={e => setField(kind, e.target.value)}
                                            placeholder={t(`groupBranding.${kind}_placeholder`)}
                                            aria-invalid={invalid}
                                            aria-describedby={invalid ? `${inputId}-error` : undefined}
                                            data-testid={`group-branding-${kind}`}
                                            className={`w-full min-h-11 pl-10 pr-4 py-2.5 text-base rounded-xl border bg-white text-stone-900 placeholder-stone-400 focus:ring-2 outline-none transition-all ${invalid ? 'border-rose-300 focus:border-rose-400 focus:ring-rose-100' : 'border-stone-200 focus:border-teal-500 focus:ring-teal-500/20'}`}
                                        />
                                    </span>
                                    {invalid && (
                                        <p id={`${inputId}-error`} role="alert" data-testid={`group-branding-${kind}-error`} className="mt-1 text-xs font-medium text-rose-600">
                                            {t(`groupBranding.${kind}_invalid`)}
                                        </p>
                                    )}
                                </div>
                            );
                        })}
                        <p className="text-sm text-stone-500">{t('groupBranding.links_hint')}</p>
                    </div>
                </div>

                {/* Fondo */}
                <fieldset>
                    <legend className={sectionLabel}>{t('groupBranding.theme')}</legend>
                    <div className="grid grid-cols-2 gap-2">
                        {(['dark', 'light'] as const).map(theme => {
                            const on = form.theme === theme;
                            const tk = PUBLIC_THEME_TOKENS[theme];
                            return (
                                <label
                                    key={theme}
                                    className={`flex items-center gap-3 min-h-11 px-3 py-3 rounded-xl border cursor-pointer transition-colors ${on
                                        ? 'border-[color:var(--accent)] bg-[color:var(--accent-subtle-bg)] shadow-[inset_0_0_0_1px_var(--accent)]'
                                        : 'border-stone-200 bg-white hover:bg-stone-50'}`}
                                >
                                    <input
                                        type="radio"
                                        name={`group-theme-${orgId}`}
                                        value={theme}
                                        checked={on}
                                        onChange={() => setField('theme', theme)}
                                        className="w-4 h-4 accent-teal-600 shrink-0"
                                    />
                                    {/* The public page's own colours, so this stays true in the dashboard's dark mode. */}
                                    <span
                                        aria-hidden="true"
                                        className="w-8 h-8 shrink-0 rounded-lg inline-flex items-center justify-center text-xs font-bold border border-[color:var(--sw-border)] bg-[color:var(--sw-bg)] text-[color:var(--sw-text)]"
                                        style={{ '--sw-bg': theme === 'light' ? tk.card : tk.bg, '--sw-text': tk.text, '--sw-border': tk.border } as CSSProperties}
                                    >
                                        Aa
                                    </span>
                                    <span className="min-w-0 [overflow-wrap:anywhere]">
                                        <span className="block text-sm font-semibold text-stone-900">{t(`groupBranding.theme_${theme}`)}</span>
                                        <span className="block text-xs text-stone-500">{t(`groupBranding.theme_${theme}_hint`)}</span>
                                    </span>
                                </label>
                            );
                        })}
                    </div>
                </fieldset>

                {/* Color — the shade for the chosen Fondo; selected = check + ring + bold name, never colour alone. */}
                <fieldset>
                    <legend className={sectionLabel}>{t('groupBranding.color')}</legend>
                    <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
                        {ACCENTS.map(a => {
                            const on = form.accentId === a.id;
                            return (
                                <label
                                    key={a.id}
                                    data-testid="group-branding-swatch"
                                    data-accent={a.id}
                                    className="flex flex-col items-center gap-1 min-h-11 py-1 rounded-xl cursor-pointer hover:bg-stone-50 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-[color:var(--accent)]"
                                >
                                    <input
                                        type="radio"
                                        name={`group-accent-${orgId}`}
                                        value={a.id}
                                        data-accent={a.id}
                                        checked={on}
                                        onChange={() => setField('accentId', a.id)}
                                        className="sr-only"
                                    />
                                    <span
                                        aria-hidden="true"
                                        className={`w-10 h-10 rounded-full flex items-center justify-center bg-[color:var(--sw)] text-[color:var(--sw-on)] ${on
                                            ? 'shadow-[0_0_0_2px_var(--surface-card),0_0_0_4px_var(--text-primary)]'
                                            : 'shadow-[0_0_0_1px_var(--text-muted)]'}`}
                                        style={{ '--sw': accentShade(a.id, form.theme), '--sw-on': onAccent } as CSSProperties}
                                    >
                                        {on && <CheckIcon />}
                                    </span>
                                    <span className={`text-xs leading-tight ${on ? 'font-bold text-stone-900' : 'font-medium text-stone-500'}`}>{a.name}</span>
                                </label>
                            );
                        })}
                    </div>
                </fieldset>

                {/* Vista previa */}
                <div>
                    <h3 className={sectionLabel}>{t('groupBranding.preview')}</h3>
                    <GroupBrandingPreview
                        orgName={orgName}
                        theme={form.theme}
                        accentId={form.accentId}
                        logoUrl={data.logoUrl}
                        bannerUrl={data.bannerUrl}
                        links={previewLinks}
                        countText={t('groupBranding.preview_text')}
                        buttonText={t('groupBranding.preview_button')}
                        ariaLabel={t('groupBranding.preview_label')}
                    />
                    <p className="text-sm text-stone-500 mt-2">{t('groupBranding.preview_caption')}</p>
                </div>

                <div className="space-y-2">
                    <button
                        type="button"
                        onClick={handleSave}
                        disabled={saving || busy}
                        data-testid="group-branding-save"
                        className="inline-flex items-center justify-center gap-2 px-6 py-2.5 min-h-11 text-sm font-bold text-white bg-teal-600 hover:bg-teal-700 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {saving && <Spinner className="w-4 h-4" />}
                        {t('common.save')}
                    </button>
                    {data.updatedAt && data.updatedByName && (
                        <p data-testid="group-branding-last-edited" className="text-xs text-stone-500">
                            {t('groupBranding.last_edited').replace('{name}', data.updatedByName).replace('{date}', formatDateTime(data.updatedAt))}
                        </p>
                    )}
                </div>
            </>
        );
    };

    return (
        <div className="border-t border-stone-100" data-testid="group-branding" data-org-id={orgId}>
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                aria-expanded={open}
                aria-controls={bodyId}
                data-testid="group-branding-toggle"
                className="w-full flex items-center justify-between gap-3 min-h-11 px-5 py-3 text-left transition-colors hover:bg-stone-50"
            >
                <span className="flex items-center gap-2 min-w-0">
                    <svg className="w-5 h-5 shrink-0 text-teal-700" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.5-.8 1.5-1.5 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.8.7-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-4.1-4-7.8-9-7.8z" />
                        <circle cx="7.5" cy="11.5" r="1" /><circle cx="10.5" cy="7.5" r="1" /><circle cx="15.5" cy="8.5" r="1" />
                    </svg>
                    <span className="text-sm font-semibold text-stone-900">{t('groupBranding.toggle')}</span>
                    {!open && <span className="text-sm text-stone-500 truncate">· {t('groupBranding.toggle_hint')}</span>}
                </span>
                <svg className={`w-4 h-4 shrink-0 text-stone-500 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>
            {open && (
                <div id={bodyId} className="px-5 pb-5 space-y-6">
                    {renderBody()}
                </div>
            )}
        </div>
    );
}
