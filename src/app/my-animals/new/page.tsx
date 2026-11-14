'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useSession } from 'next-auth/react';
import { useAuthContext } from '@/context/AuthContext';
import { useShowToast } from '@/components/ui/Toast';
import { saveAdoption, deleteAnimalForAdoption, deleteAnimalImage } from '@/app/actions';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { getApplicantsForAnimal } from '@/app/actions/applicants';
import { candidatesLostOnDelete } from '@/domain/applications';
import { animalDeleteWarningText } from '@/components/evaluation/AnimalDeleteWarning';
import { deriveAgeFromBirthDate, parseLegacyAge } from '@/lib/ageUtils';
import Link from 'next/link';
import { zarazTrack } from '@/lib/zaraz';
import { isFemaleAnimal } from '@/domain/animalSex';
import { generalRequestHref, newAnimalProposeMode, proposeParam } from '@/domain/applications';
import { changeProposedAnimal, getGeneralApplications, proposeAnimal } from '@/app/actions/applications';
import { proposeNewOutcome } from '@/components/evaluation/ProposeAnimalSheet';
import { firstName } from '@/lib/householdCopy';
import { handledAsStale } from '@/lib/errorMessage';
import AnimalFields, { EMPTY_ANIMAL_FIELDS, type AnimalFieldsValue } from '@/components/animals/AnimalFields';
import PostSourceBox, { type PostReadResult } from '@/components/animals/PostSourceBox';
import PostPhotoGrid from '@/components/animals/PostPhotoGrid';
import LitterReview, { fieldsFromImported } from '@/components/animals/LitterReview';
import { SamePostNotice, SameNameNotice } from '@/components/animals/ImportMatchNotices';
import { storePostPhotos, mergeIntoAnimal, birthDateFor } from '@/components/animals/importSave';
import { findAnimalImportMatches, type AnimalImportMatches } from '@/app/actions/animalImport';
import { takeSharedImages } from '@/lib/shareTargetCache';

/** Compress image to max 1200px and JPEG 80% */
function compressImage(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                if (!ctx) { reject(new Error('Canvas context failed')); return; }
                const maxSize = 1200;
                let width = img.width;
                let height = img.height;
                if (width > height) { if (width > maxSize) { height = (height * maxSize) / width; width = maxSize; } }
                else { if (height > maxSize) { width = (width * maxSize) / height; height = maxSize; } }
                canvas.width = width; canvas.height = height;
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', 0.8));
            };
            img.onerror = () => reject(new Error('Failed to load image'));
            img.src = e.target?.result as string;
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
    });
}

interface ExistingImage {
    id: string;
    url: string;
    caption: string | null;
}

/**
 * v2.55.20: this route is CREATE-ONLY.
 *
 * The form below submits a hardcoded envelope (`recordType:'available'`,
 * `adopterId:null`), so saving it for an EXISTING animal ends any active
 * foster/adoption span — the long-standing "editing a foster silently
 * un-places it" bug. v2.55.15 moved identity editing in-place onto
 * /my-animals/[id] (which patches only `animals` fields) and removed every UI
 * link here, but `?edit=<id>` stayed reachable by URL — and since v2.55.18 the
 * lookup is team-scoped, so a stale bookmark could silently un-place a
 * TEAMMATE's animal. So `?edit=` is no longer honored: it redirects to the
 * animal's page, where editing is safe.
 */
export default function NewAnimalPage() {
    const searchParams = useSearchParams();
    const legacyEditId = searchParams.get('edit');
    const router = useRouter();

    useEffect(() => {
        if (legacyEditId) router.replace(`/my-animals/${legacyEditId}`);
    }, [legacyEditId, router]);

    if (legacyEditId) return null;
    // From the phone's share sheet, via «¿Qué hay en este post?» on /import.
    const sharedUrl = searchParams.get('shared_url') || '';
    const sharedText = searchParams.get('shared_text') || '';
    const share = sharedUrl || sharedText || searchParams.get('shared_images') === 'true' || searchParams.get('shared_images_lost') === 'true'
        ? { url: sharedUrl, text: sharedText, withImages: searchParams.get('shared_images') === 'true', imagesLost: searchParams.get('shared_images_lost') === 'true' }
        : null;
    return <CreateAnimalForm proposeTo={proposeParam(searchParams.get('proponer'))} share={share} />;
}

/**
 * `proposeTo`: opened from «Sumar a un animal» → «Cargar un animal» (Jon
 * 2026-11-13). While that general application is still to evaluate, the page
 * names the person, the button reads «Agregar y sumar a {name}», saving
 * also adds the person to the new animal, and every way out goes back to the request.
 * Already added and still undoable («Cambiar animal» → «Cargar otro animal», UX review S3): saving MOVES the
 * person to the new animal («Agregar y pasar a {name}»). Otherwise (decided meanwhile, not the viewer's team)
 * it is the plain page — `newAnimalProposeMode`.
 */
function CreateAnimalForm({ proposeTo, share }: { proposeTo: string | null; share: { url: string; text: string; withImages: boolean; imagesLost: boolean } | null }) {
    const router = useRouter();
    const editId: string | null = null;
    const isEditMode = false;

    const { t, locale } = useLanguage();
    const { data: session } = useSession();
    const { openLogin } = useAuthContext();
    const toast = useShowToast();

    const [loading, setLoading] = useState(false);
    // What saving does for the request's person: read from the request itself (that one only), never from the
    // address. undefined = still reading (the save button waits), null = nothing to do (plain page).
    const [proposeMode, setProposeMode] = useState<ReturnType<typeof newAnimalProposeMode> | undefined>(proposeTo ? undefined : null);
    const proposeName = proposeMode ? (firstName(proposeMode.name) || proposeMode.name) : proposeMode;
    const changeFrom = proposeMode?.kind === 'change' ? proposeMode.from : null;
    useEffect(() => {
        if (!proposeTo) return;
        let current = true;
        getGeneralApplications({ applicationId: proposeTo })
            .then((res) => {
                if (!current) return;
                if (!res.ok) { setProposeMode(null); toast.error(t('errors.generic'), t('evaluation.action_failed'), res.errorId); return; }
                setProposeMode(newAnimalProposeMode(res.applicants.find(x => x.applicationId === proposeTo) ?? null));
            })
            .catch((e: unknown) => {
                // The page still adds the animal; it just doesn't propose it.
                if (!current) return;
                setProposeMode(null);
                if (!handledAsStale(e)) toast.error(t('errors.generic'), t('evaluation.action_failed'), resolveErrorId(e, 'my-animals/new:propose'));
            });
        return () => { current = false; };
        // Read once per request id; `t`/`toast` are stable enough for an error message.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [proposeTo]);
    const proposeReading = proposeName === undefined;
    const proposing = !!proposeTo && typeof proposeName === 'string';
    // Opened from a request: every way out goes back to it, proposed or not.
    const exitHref = proposeTo ? generalRequestHref(proposeTo) : '/my-animals';
    const [loadingData, setLoadingData] = useState(isEditMode);
    const [uploading, setUploading] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [pendingImages, setPendingImages] = useState<string[]>([]);
    const [existingImages, setExistingImages] = useState<ExistingImage[]>([]);
    const [formData, setFormData] = useState<AnimalFieldsValue>(EMPTY_ANIMAL_FIELDS);

    // ── «Cargar desde un post» (Jon 2026-11-14) ──
    /** What the post filled. One animal → this form; several → LitterReview. */
    const [post, setPost] = useState<PostReadResult | null>(null);
    /** The post's link — kept even when it could not be read, to save with a hand-filled animal. */
    const [postSourceUrl, setPostSourceUrl] = useState('');
    const [postSel, setPostSel] = useState<Set<number>>(new Set());
    const [matches, setMatches] = useState<Extract<AnimalImportMatches, { ok: true }> | null>(null);
    const [samePostOk, setSamePostOk] = useState(false);
    const [nameMatchAnswered, setNameMatchAnswered] = useState(false);
    const [merging, setMerging] = useState(false);
    const [shareStart, setShareStart] = useState<{ url: string; text: string; images: Array<{ data: string; mimeType: string }> } | null>(null);
    const single = !!post && post.extraction.animals.length === 1;
    const litter = !!post && post.extraction.animals.length > 1;
    const postDate = post?.extraction.postDate ?? null;
    const dateFmt = (opts: Intl.DateTimeFormatOptions) => postDate
        ? new Date(`${postDate}T12:00:00Z`).toLocaleDateString(locale === 'en' ? 'en-US' : locale === 'pt' ? 'pt-BR' : 'es-AR', { ...opts, timeZone: 'UTC' })
        : null;
    const ageNote = postDate ? t('animalImport.age_note').replace('{date}', dateFmt({ day: 'numeric', month: 'long' }) ?? '') : undefined;

    useEffect(() => {
        if (!share) return;
        // At once: a reload must not read the post again, and the caption must not linger in the address.
        window.history.replaceState(null, '', '/my-animals/new');
        if (share.imagesLost) toast.warning(t('animalImport.shared_photos_lost'));
        let live = true;
        (async () => {
            const images = share.withImages
                ? await takeSharedImages().catch((e: unknown) => { resolveErrorId(e, 'my-animals/new:shared-images'); return []; })
                : [];
            if (live && (share.url || share.text || images.length)) setShareStart({ url: share.url, text: share.text, images });
        })();
        return () => { live = false; };
        // Once, from the URL the page opened with.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /** Each read gets a number; an answer for an earlier read (after «Cambiar») is dropped, never shown over another post. */
    const readSeq = useRef(0);
    const onPostRead = (r: PostReadResult) => {
        const seq = ++readSeq.current;
        setPost(r);
        setPostSourceUrl(r.sourceUrl);
        setMatches(null); setSamePostOk(false); setNameMatchAnswered(false);
        if (r.extraction.animals.length === 1) {
            setFormData(fieldsFromImported(r.extraction.animals[0]));
            setPostSel(new Set(r.extraction.animals[0].photos));
        }
        zarazTrack('animal_import_read', { animals: r.extraction.animals.length, from: r.from, hasDate: r.extraction.postDate ? 1 : 0 });
        findAnimalImportMatches({
            sourceUrls: [r.sourceUrl, r.linkAsGiven].filter((u): u is string => !!u),
            animals: r.extraction.animals.map(a => ({ name: a.name, species: a.species })),
        }).then(m => {
            if (seq !== readSeq.current) return;
            if (m.ok) setMatches(m);
            else toast.error(t('errors.generic'), t('animalImport.matches_failed'), m.errorId);
        }).catch((e: unknown) => {
            if (seq !== readSeq.current || handledAsStale(e)) return;
            toast.error(t('errors.generic'), t('animalImport.matches_failed'), resolveErrorId(e, 'my-animals/new:matches'));
        });
    };
    const onPostReset = () => {
        readSeq.current++;
        setPost(null); setPostSourceUrl(''); setMatches(null); setSamePostOk(false); setNameMatchAnswered(false);
        setPostSel(new Set()); setFormData(EMPTY_ANIMAL_FIELDS);
    };
    const nameMatch = single && !nameMatchAnswered ? matches?.sameName[0] ?? null : null;
    const showSamePost = !!matches && !samePostOk && (matches.samePostMine.length > 0 || matches.samePostOthers.length > 0);

    /** «Sí: sumarle las fotos y los datos» on the one animal of the post. */
    const mergeSingle = async () => {
        if (!nameMatch || !post) return;
        setMerging(true);
        try {
            const r = await mergeIntoAnimal(nameMatch, formData, [...postSel].map(i => post.photos[i]), { sourceUrl: postSourceUrl, postDate });
            const name = nameMatch.name || formData.animalName;
            if (r.photosFailed > 0) toast.error(t('animalImport.merged').replace('{name}', name), t('animalImport.photos_not_saved').replace('{n}', String(r.photosFailed)), r.errorIds[0]);
            else toast.success(t('toast.saved_title'), t('animalImport.merged').replace('{name}', name));
            zarazTrack('animal_import_merged', { photos: postSel.size });
            router.push(`/my-animals/${encodeURIComponent(nameMatch.id)}`);
        } catch (e) {
            if (!handledAsStale(e)) toast.error(t('errors.generic'), t('animalImport.merge_failed').replace('{name}', nameMatch.name || ''), resolveErrorId(e, 'my-animals/new:merge'));
        } finally {
            setMerging(false);
        }
    };

    // Fetch existing animal data in edit mode
    useEffect(() => {
        if (!editId) return;
        async function fetchAnimal() {
            setLoadingData(true);
            try {
                // Fetch ONLY the animal being edited — not the whole list. Pulling
                // `view=all` and .find()-ing here 500'd for large rescuers (the API
                // enriched every record → past the Workers subrequest limit).
                const res = await fetch(`/api/my-animals?id=${encodeURIComponent(editId!)}`);
                if (!res.ok) {
                    const body = await res.json().catch(() => ({})) as { error?: string; errorId?: string };
                    throw new Error(body.error ? `${body.error} (Error ID: ${body.errorId || 'n/a'})` : 'Failed to fetch animals');
                }
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const animals = await res.json() as any[];
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const animal = animals.find((a: any) => a.id === editId);
                if (animal) {
                    let ageValue = '';
                    let ageUnit: 'months' | 'years' = 'months';
                    if (animal.estimatedBirthDate) {
                        const parsed = deriveAgeFromBirthDate(animal.estimatedBirthDate);
                        ageValue = String(parsed.value); ageUnit = parsed.unit;
                    } else if (animal.age) {
                        const parsed = parseLegacyAge(animal.age);
                        if (parsed) { ageValue = String(parsed.value); ageUnit = parsed.unit; }
                    }
                    setFormData({
                        animalName: animal.animalName || '',
                        species: animal.species || 'cat',
                        details: animal.details || '',
                        sex: animal.sex || '',
                        neutered: animal.neutered === 1 ? '1' : animal.neutered === 0 ? '0' : '',
                        color: animal.color || '',
                        microchip: animal.microchip || '',
                        ageValue, ageUnit,
                    });
                    if (animal.images && animal.images.length > 0) {
                        setExistingImages(animal.images);
                    }
                } else {
                    toast.error(t('toast.not_found_title'), t('errors.not_found_animal'));
                    router.push('/my-animals');
                }
            } catch (err) {
                console.error('Failed to load animal:', err);
                toast.error(t('errors.generic'), t('errors.load_animal_failed'), resolveErrorId(err, 'page'));
            } finally {
                setLoadingData(false);
            }
        }
        fetchAnimal();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editId]);

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            toast.error(t('toast.invalid_file_title'), t('errors.upload_invalid_image'));
            return;
        }
        e.target.value = '';
        setUploading(true);
        try {
            const base64 = await compressImage(file);
            setPendingImages(prev => [...prev, base64]);
        } catch (error) {
            toast.error(t('toast.upload_failed_title'), t('errors.upload_image_failed'), resolveErrorId(error, 'page'));
        } finally {
            setUploading(false);
        }
    };

    /** The animal is saved: propose it to the request's person, say how it went, go back to the request. */
    const proposeNew = async (animalId: string) => {
        const animal = formData.animalName.trim() || t('homeModules.unnamed_animal');
        const who = proposeName ?? '';
        const g = isFemaleAnimal(formData.sex) ? '_f' : '';
        const fill = (key: string) => t(key).replace('{animal}', animal).replace('{name}', who);
        if (changeFrom) {
            // «Cambiar animal» → «Cargar otro animal»: the person moves from the first animal to this one.
            const from = changeFrom.name || t('homeModules.unnamed_animal');
            const fillChange = (key: string) => fill(key).replace('{from}', from);
            try {
                const res = await changeProposedAnimal(proposeTo!, animalId);
                if (res.ok) toast.success(t('toast.saved_title'), fill('evaluation.propose_new_change_done'));
                else if (res.error === 'already_acted') toast.info(fillChange(`evaluation.propose_new_change_refused${g}`));
                else if (res.error === 'same_person_unanswered') toast.info(fill(`evaluation.propose_new_same_person${g}`));
                else toast.error(t('errors.generic'), fill(`evaluation.propose_new_saved_not_proposed${g}`),
                    res.errorId || resolveErrorId(new Error(`changeProposedAnimal: ${res.error}`), 'my-animals/new:change'));
            } catch (e) {
                if (!handledAsStale(e)) toast.error(t('errors.generic'), fill(`evaluation.propose_new_saved_not_proposed${g}`), resolveErrorId(e, 'my-animals/new:change'));
            }
            router.push(generalRequestHref(proposeTo!));
            return;
        }
        try {
            const res = await proposeAnimal(proposeTo!, animalId);
            const next = proposeNewOutcome(res);
            if (next === 'proposed') toast.success(t('toast.saved_title'), fill('evaluation.propose_new_done'));
            else if (next === 'decided') toast.info(fill(`evaluation.propose_new_decided${g}`));
            else if (next === 'same_person') toast.info(fill(`evaluation.propose_new_same_person${g}`));
            else if (next === 'already_candidate') toast.info(fill('evaluation.propose_already'));
            else toast.error(t('errors.generic'), fill(`evaluation.propose_new_saved_not_proposed${g}`),
                (!res.ok && res.errorId) || resolveErrorId(new Error(`proposeAnimal: ${res.ok ? 'unknown' : res.error}`), 'my-animals/new:propose'));
        } catch (e) {
            if (!handledAsStale(e)) toast.error(t('errors.generic'), fill(`evaluation.propose_new_saved_not_proposed${g}`), resolveErrorId(e, 'my-animals/new:propose'));
        }
        router.push(generalRequestHref(proposeTo!));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!session?.user) { openLogin(); return; }

        setLoading(true);
        try {
            // Compute estimated birth date from age input
            // From a post, the age was true on the post's date (when known).
            const estimatedBirthDate = birthDateFor(formData, postDate);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const payload: any = {
                animalName: formData.animalName,
                species: formData.species,
                details: formData.details,
                comments: '',
                age: null,
                estimatedBirthDate,
                sex: formData.sex || null,
                neutered: formData.neutered === '1' ? 1 : formData.neutered === '0' ? 0 : null,
                color: formData.color || null,
                microchip: formData.microchip || null,
                recordType: 'available',
                status: 'active',
                rating: null,
                date: new Date(),
                adopterId: null,
                onBehalfOf: null,
                deliveredToHome: 0,
                verifiedAddress: null,
                identityVerified: 0,
                ...(postSourceUrl ? { sourceUrl: postSourceUrl } : {}),
            };

            // In edit mode, include the ID so saveAdoption updates instead of creates
            if (isEditMode && editId) {
                payload.id = editId;
            }

            const result = await saveAdoption(payload);

            // Upload any NEW pending images
            if (pendingImages.length > 0 && (result?.id || editId)) {
                const { saveImage } = await import('@/app/actions');
                const targetId = result?.id || editId || '';
                for (const img of pendingImages) {
                    await saveImage('__available__', img, `Photo for ${formData.animalName}`, targetId || undefined, 'image', false, 'animal');
                }
            }

            // The post's photos the rescuer kept.
            let postPhotosFailed = 0;
            let postPhotoErrorId: string | undefined;
            if (single && post && result?.id && postSel.size > 0) {
                const r = await storePostPhotos(result.id, formData.animalName, [...postSel].map(i => post.photos[i]));
                postPhotosFailed = r.failed;
                postPhotoErrorId = r.errorIds[0];
            }

            if (!isEditMode && result?.id) {
                zarazTrack('animal_listed', { species: formData.species, hasMedia: pendingImages.length + postSel.size > 0 ? 1 : 0 });
                if (single) zarazTrack('animal_imported', { count: 1, litter: 0, failed: 0 });
            }
            if (postPhotosFailed > 0) toast.error(t('errors.generic'), t('animalImport.photos_not_saved').replace('{n}', String(postPhotosFailed)), postPhotoErrorId);

            if (proposing && result?.id) {
                await proposeNew(result.id);
                return;
            }

            toast.success(
                t('toast.saved_title'),
                isEditMode
                    ? t('dashboard.animal_updated')
                    : (t(isFemaleAnimal(formData.sex) ? 'dashboard.animal_listed_f' : 'dashboard.animal_listed') || `${formData.animalName} listed for adoption!`).replace('{name}', formData.animalName),
            );
            router.push('/my-animals');
        } catch (err) {
            console.error(err);
            toast.error(t('errors.generic'), t('errors.save_animal_failed'), resolveErrorId(err, 'page'));
        } finally {
            setLoading(false);
        }
    };

    if (loadingData) {
        return (
            <div className="min-h-screen bg-stone-50 py-12 px-4 flex items-center justify-center">
                <div className="text-stone-500">{t('common.loading') || 'Loading...'}</div>
            </div>
        );
    }

    const photoCount = existingImages.length + pendingImages.length + (single ? postSel.size : 0);

    return (
        <div className="min-h-screen bg-stone-50 py-12 px-4">
            <div className="max-w-2xl mx-auto">
                {/* Header */}
                <div className="flex items-center gap-4 mb-8">
                    <Link href={exitHref} className="text-stone-500 hover:text-stone-700 transition-colors">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                    </Link>
                    <h1 className="text-3xl font-extrabold text-stone-900 tracking-tight">
                        🐾 {isEditMode
                            ? (t('dashboard.edit_animal') || 'Edit Animal')
                            : (t('dashboard.add_animal') || 'Add Animal for Adoption')
                        }
                    </h1>
                </div>

                {/* The note keeps its place while the request is read, so the form doesn't jump down. */}
                {(proposing || proposeReading) && (
                    <p data-testid="propose-new-note" aria-busy={proposeReading} className="rounded-xl px-4 py-3 mb-4 bg-teal-50 border border-teal-200 text-sm text-teal-800 [overflow-wrap:anywhere]">
                        {!proposing ? t('common.loading')
                            : changeFrom ? t('evaluation.propose_new_change_note').replace('{name}', proposeName ?? '').replace('{from}', changeFrom.name || t('homeModules.unnamed_animal'))
                                : t('evaluation.propose_new_note').replace('{name}', proposeName ?? '')}
                    </p>
                )}
                {/* Not offered while proposing to a request: that flow is about one animal, chosen there. */}
                {!proposeTo && (
                    <PostSourceBox
                        start={shareStart}
                        onRead={onPostRead}
                        onSourceOnly={setPostSourceUrl}
                        onReset={onPostReset}
                        dateLabel={dateFmt({ day: 'numeric', month: 'short' })}
                    />
                )}
                {showSamePost && (
                    <div className="mb-4">
                        <SamePostNotice mine={matches!.samePostMine} others={matches!.samePostOthers} onContinue={() => setSamePostOk(true)} />
                    </div>
                )}
                {!showSamePost && nameMatch && (
                    <div className="mb-4">
                        <SameNameNotice match={nameMatch} busy={merging} onYes={() => void mergeSingle()} onNo={() => setNameMatchAnswered(true)} />
                    </div>
                )}
                {litter && post ? (
                    <LitterReview
                        animals={post.extraction.animals}
                        photos={post.photos}
                        sourceUrl={postSourceUrl}
                        postDate={postDate}
                        sameName={matches?.sameName ?? post.extraction.animals.map(() => null)}
                        ageNote={ageNote}
                    />
                ) : (
                <div className="bg-white p-5 rounded-xl border-2 border-teal-400/50 shadow-lg ring-4 ring-teal-50/50">
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <AnimalFields value={formData} onChange={setFormData} nudge={single} ageNote={single ? ageNote : undefined} />

                        {/* Photos */}
                        <div className="p-4 bg-teal-50 rounded-lg border border-teal-100">
                            <label className="block text-xs font-semibold text-teal-800 mb-2 uppercase tracking-wider flex items-center gap-2">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                {t('common.photos_title')}
                            </label>

                            {single && post && (
                                <PostPhotoGrid photos={post.photos} selected={postSel}
                                    onToggle={i => setPostSel(prev => { const n = new Set(prev); if (n.has(i)) n.delete(i); else n.add(i); return n; })} />
                            )}

                            {/* Existing images (from DB, in edit mode) */}
                            {existingImages.length > 0 && (
                                <div className="flex flex-wrap gap-2 mb-3">
                                    {existingImages.map((img) => (
                                        <div key={img.id} className="relative group">
                                            <img
                                                src={img.url}
                                                alt={img.caption || 'Photo'}
                                                className="w-20 h-20 object-cover rounded-lg border border-teal-200"
                                            />
                                            <button
                                                type="button"
                                                onClick={async () => {
                                                    if (!editId) return;
                                                    const confirmed = window.confirm(
                                                        locale !== 'en'
                                                            ? '¿Eliminar esta foto? Esta acción no se puede deshacer.'
                                                            : 'Delete this photo? This cannot be undone.'
                                                    );
                                                    if (!confirmed) return;
                                                    try {
                                                        await deleteAnimalImage(img.id, editId);
                                                        setExistingImages(prev => prev.filter(i => i.id !== img.id));
                                                        toast.success('✓', locale !== 'en' ? 'Foto eliminada' : 'Photo deleted');
                                                    } catch (err) {
                                                        toast.error('Error', locale !== 'en' ? 'No se pudo eliminar la foto' : 'Could not delete photo', resolveErrorId(err, 'page'));
                                                    }
                                                }}
                                                className="absolute -top-1 -right-1 w-5 h-5 bg-rose-500 text-white rounded-full text-xs font-semibold opacity-0 group-hover:opacity-100 transition-opacity hover:bg-rose-600 flex items-center justify-center shadow"
                                                title={locale !== 'en' ? 'Eliminar foto' : 'Delete photo'}
                                            >
                                                ×
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* New pending images */}
                            {pendingImages.length > 0 && (
                                <div className="flex flex-wrap gap-2 mb-3">
                                    {pendingImages.map((img, idx) => (
                                        <div key={idx} className="relative group">
                                            <img
                                                src={img}
                                                alt={`New photo ${idx + 1}`}
                                                className="w-20 h-20 object-cover rounded-lg border border-teal-300"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setPendingImages(prev => prev.filter((_, i) => i !== idx))}
                                                className="absolute -top-1 -right-1 w-5 h-5 bg-rose-500 text-white rounded-full text-xs font-semibold opacity-0 group-hover:opacity-100 transition-opacity hover:bg-rose-600 flex items-center justify-center shadow"
                                                title="Remove"
                                            >
                                                ×
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <div className="flex items-center gap-3">
                                <label className={`px-4 py-2 bg-white border border-teal-200 text-teal-700 rounded-lg text-sm font-semibold cursor-pointer hover:bg-teal-50 transition-colors ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
                                    {uploading ? (t('adopter.uploading') || 'Uploading...') : (t('common.add_photo') || '+ Add Photo')}
                                    <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={uploading} />
                                </label>
                                <span className="text-xs text-teal-700">{photoCount} {photoCount === 1 ? (t('common.photo_one') || 'photo') : (t('common.photos') || 'photos')}</span>
                            </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center justify-between gap-3 pt-4 border-t border-stone-100">
                            {/* Delete button (edit mode only) */}
                            {isEditMode && editId ? (
                                <button
                                    type="button"
                                    disabled={deleting}
                                    onClick={async () => {
                                        const animalName = formData.animalName || 'Animal';
                                        // Candidates the delete would lose: one read; a failed read says the generic warning (never zero).
                                        let lost: number | null = null;
                                        try {
                                            const load = await getApplicantsForAnimal(editId);
                                            if (load.ok) lost = candidatesLostOnDelete(load.applicants);
                                        } catch (err) {
                                            resolveErrorId(err, 'page'); // reports with context; the confirm falls back to the generic warning
                                        }
                                        const warning = animalDeleteWarningText(t, animalName, lost);
                                        const confirmed = window.confirm(
                                            t('animalProfile.delete_confirm_plain').replace('{name}', animalName) + (warning ? '\n\n' + warning : '')
                                        );
                                        if (!confirmed) return;
                                        setDeleting(true);
                                        try {
                                            await deleteAnimalForAdoption(editId);
                                            toast.success('✓', locale !== 'en' ? 'Animal eliminado' : 'Animal deleted');
                                            router.push('/my-animals');
                                        } catch (err) {
                                            toast.error('Error', locale !== 'en' ? 'No se pudo eliminar' : 'Could not delete', resolveErrorId(err, 'page'));
                                            setDeleting(false);
                                        }
                                    }}
                                    className="px-4 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-50 rounded-lg transition-colors disabled:opacity-50"
                                >
                                    {deleting
                                        ? (locale !== 'en' ? 'Eliminando...' : 'Deleting...')
                                        : '🗑️ ' + (locale !== 'en' ? 'Eliminar animal' : 'Delete animal')
                                    }
                                </button>
                            ) : <div />}

                            <div className="flex gap-3">
                                <Link
                                    href={exitHref}
                                    className="px-5 py-2.5 text-sm font-semibold text-stone-600 hover:bg-stone-100 rounded-lg transition-colors"
                                >
                                    {t('common.cancel') || 'Cancel'}
                                </Link>
                                <button
                                    type="submit"
                                    disabled={loading || proposeReading}
                                    className="px-6 py-2.5 text-sm font-semibold text-white bg-teal-700 rounded-xl hover:bg-teal-600 shadow-lg shadow-teal-700/20 hover:shadow-teal-700/40 disabled:opacity-50 transition-all duration-300 active:scale-[0.99]"
                                >
                                    {loading
                                        ? (t('common.processing') || 'Processing...')
                                        : isEditMode
                                            ? '💾 ' + (t('common.save') || 'Save Changes')
                                            : proposing
                                                ? t(changeFrom ? 'evaluation.propose_new_change_submit' : 'evaluation.propose_new_submit').replace('{name}', proposeName ?? '')
                                                : '🐾 ' + (t('dashboard.add_animal') || 'Add Animal')
                                    }
                                </button>
                            </div>
                        </div>
                    </form>
                </div>
                )}
            </div>
        </div>
    );
}
