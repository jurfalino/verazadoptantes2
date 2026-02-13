'use client';

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { saveAdopter } from "@/app/actions";
import { useLanguage } from "@/context/LanguageContext";
import { CollapsibleSection } from '@/components/CollapsibleSection';
import { useSession } from 'next-auth/react';
import { useAuthContext } from '@/context/AuthContext';
import { StarRating } from '@/components/StarRating';
import { useShowToast } from '@/components/ui/Toast';
import { formatDateTime, formatShortDate } from '@/lib/dates';


export function AdopterForm({ initialData, history = [], currentUser }: { initialData?: any, history?: any[], currentUser?: string }) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const intent = searchParams.get('intent');
    const { t } = useLanguage();
    const { data: session } = useSession();
    const { openLogin } = useAuthContext();
    const toast = useShowToast();
    const isNew = !initialData?.id;

    const [isEditing, setIsEditing] = useState(isNew);
    const [loading, setLoading] = useState(false);

    // Auth-gated click-to-edit: clicking any view field enables editing
    const handleClickToEdit = () => {
        if (isEditing) return;
        const isAuthenticated =
            (currentUser && currentUser !== '') ||
            !!session?.user;
        if (!isAuthenticated) {
            openLogin();
            return;
        }
        setIsEditing(true);
    };

    // Status uses numeric values 1-5 only
    const defaultStatus = intent === 'report' ? '1' : '5';

    const [data, setData] = useState({
        id: initialData?.id || '',
        name: initialData?.name || '',
        status: initialData?.status || defaultStatus,
        contactInfo: initialData?.contactInfo || '',

        familyMembers: initialData?.familyMembers || '',
        notes: initialData?.notes || '',
    });

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();

        // Trust server-side auth (currentUser prop) as primary source of truth
        // Fall back to client-side checks only if server didn't provide user info
        const isAuthenticated =
            (currentUser && currentUser !== '') ||
            !!session?.user;



        if (!isAuthenticated) {

            openLogin();
            return;
        }


        setLoading(true);
        try {
            const res = await saveAdopter(data);
            if (res.success) {
                if (isNew) {
                    // Check if we should continue to adoption form
                    const continueToAdoption = searchParams.get('continueToAdoption');
                    const animalName = searchParams.get('animalName') || '';
                    const species = searchParams.get('species') || '';
                    const linkAnimalId = searchParams.get('linkAnimalId') || '';

                    let redirectUrl = `/adopter/${res.id}`;
                    if (continueToAdoption === 'true') {
                        // Redirect to profile with all wizard params (adoption or observation)
                        const params = new URLSearchParams();
                        // Forward animal-related params (AdoptionWizard)
                        if (linkAnimalId) params.set('linkAnimalId', linkAnimalId);
                        if (animalName) params.set('animalName', animalName);
                        if (species) params.set('species', species);
                        // Forward observation params (ReportWizard)
                        const newAdoption = searchParams.get('newAdoption');
                        const rating = searchParams.get('rating');
                        const details = searchParams.get('details');
                        if (newAdoption) params.set('newAdoption', newAdoption);
                        else params.set('newAdoption', 'true');
                        if (rating) params.set('rating', rating);
                        if (details) params.set('details', details);
                        redirectUrl = `/adopter/${res.id}?${params.toString()}`;
                    }


                    try {
                        router.push(redirectUrl);
                        // Fallback: Force navigation if router.push doesn't work
                        setTimeout(() => {
                            if (window.location.pathname === '/adopter/create') {
                                console.warn("[ADOPTER FORM] router.push failed, using window.location");
                                window.location.href = redirectUrl;
                            }
                        }, 500);
                    } catch (navError) {
                        console.error("[ADOPTER FORM] Navigation error:", navError);
                        window.location.href = redirectUrl;
                    }
                } else {
                    setIsEditing(false);
                    router.refresh();
                }
            } else {
                console.error("[ADOPTER FORM] Save failed - no success flag");
                toast.error('Error', 'Failed to save adopter profile.');
            }
        } catch (err: any) {
            console.error("Save Error:", err);
            toast.error('Save Error', err?.message || 'An unexpected error occurred while saving.');
        } finally {
            setLoading(false);
        }
    };

    const handleCancel = () => {
        if (isNew) {
            router.back();
        } else {
            // Reset data and exit edit mode
            setData({
                id: initialData?.id || '',
                name: initialData?.name || '',
                status: initialData?.status || '5',
                contactInfo: initialData?.contactInfo || '',

                familyMembers: initialData?.familyMembers || '',
                notes: initialData?.notes || '',
            });
            setIsEditing(false);
        }
    };

    // Helper to render clickable links in text
    const renderTextWithLinks = (text: string, type: 'text' | 'address' = 'text') => {
        if (!text) return <span className="text-emerald-900/40 italic">{t('audit.empty_val')}</span>;

        if (type === 'address') {
            const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text.replace(/\n/g, ', '))}`;
            return (
                <a href={mapUrl} target="_blank" rel="noopener noreferrer" className="flex items-start gap-2 text-emerald-700 hover:text-emerald-900 group transition-colors">
                    <svg className="w-5 h-5 shrink-0 mt-0.5 text-emerald-500 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                    <span className="whitespace-pre-line group-hover:underline decoration-emerald-500/50 underline-offset-4">{text}</span>
                </a>
            );
        }

        return text.split('\n').map((line, i) => (
            <div key={i} className="min-h-[1.5em] mb-1 last:mb-0">
                {line.split(' ').map((word, j) => {
                    // URL
                    if (word.match(/^(http|https):\/\//) || word.match(/^www\./)) {
                        const href = word.startsWith('www') ? `https://${word}` : word;
                        return <a key={j} href={href} target="_blank" rel="noopener noreferrer" className="text-emerald-600 hover:text-emerald-800 hover:underline mr-1 font-medium">{word}</a>;
                    }
                    // Email
                    if (word.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
                        return <a key={j} href={`mailto:${word}`} className="text-emerald-600 hover:text-emerald-800 hover:underline mr-1 font-medium">{word}</a>;
                    }
                    // Phone (Simple detection: 7+ digits, maybe dashes/dots)
                    if (word.match(/^(\+?\d{1,3}[-.]?)?\(?\d{3}\)?[-.]?\d{3}[-.]?\d{4}$/)) {
                        return <a key={j} href={`tel:${word}`} className="text-emerald-600 hover:text-emerald-800 hover:underline mr-1 font-medium bg-emerald-50 px-1 rounded">{word}</a>;
                    }
                    return <span key={j} className="mr-1">{word}</span>;
                })}
            </div>
        ));
    };

    return (
        <div className={`bg-white rounded-2xl shadow-sm border border-emerald-100/60 relative group transition-all duration-300 overflow-hidden ${isEditing ? 'ring-4 ring-emerald-50/50' : ''}`}>

            <form onSubmit={handleSave} className="p-5">
                {/* UNIFIED HEADER */}
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-emerald-100/60 pb-6 mb-10 gap-6">
                    {/* ... (keep header content: Name, Status, Buttons) ... */}
                    {/* Left: Name (Identity) */}
                    <div className="w-full md:w-auto">
                        {isEditing ? (
                            <input
                                type="text"
                                required
                                className="w-full text-3xl font-bold text-emerald-900 bg-transparent border-b-2 border-emerald-200 focus:border-emerald-500 outline-none px-1 py-1 placeholder-emerald-900/30 transition-all"
                                value={data.name}
                                onChange={e => setData({ ...data, name: e.target.value })}
                                placeholder={t('adopter.placeholder_name_aliases')}
                                autoFocus
                            />
                        ) : (
                            <h2
                                className="text-3xl font-bold text-emerald-900 tracking-tight px-1 py-1 border-b-2 border-transparent cursor-pointer hover:border-emerald-300 transition-colors"
                                onClick={handleClickToEdit}
                                title={t('common.edit') || 'Click to edit'}
                            >
                                {data.name}
                            </h2>
                        )}
                    </div>

                    {/* Right: Actions */}
                    <div className="flex items-center gap-4 w-full md:w-auto justify-between md:justify-end">

                        {/* Action Buttons */}
                        {isEditing ? (
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={handleCancel}
                                    className="px-4 py-2 text-sm font-bold text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors"
                                >
                                    {t('common.cancel')}
                                </button>
                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="px-6 py-2 text-sm font-bold text-white bg-emerald-500 rounded-lg hover:bg-emerald-600 focus:ring-4 focus:ring-emerald-200 disabled:opacity-70 disabled:cursor-not-allowed transition-all shadow-lg shadow-emerald-500/30 transform active:scale-95"
                                >
                                    {loading ? t('common.loading') : t('common.save')}
                                </button>
                            </div>
                        ) : (
                            <button
                                type="button"
                                onClick={handleClickToEdit}
                                className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                {t('common.edit')}
                            </button>
                        )}
                    </div>
                </div>

                {/* SHARED CONTENT GRID */}
                <div className={`grid md:grid-cols-2 gap-6 ${isEditing ? 'opacity-100' : 'opacity-90'}`}>
                    {/* Contact Info */}
                    <div className="md:col-span-2">
                        <h3 className="text-sm font-bold text-emerald-800 mb-3 uppercase tracking-wider">{t('adopter.contact')}</h3>
                        {isEditing ? (
                            <textarea
                                rows={3}
                                className="w-full p-4 rounded-xl border border-emerald-200 bg-white text-emerald-900 placeholder-emerald-800/40 font-medium focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all outline-none resize-y min-h-[80px]"
                                value={data.contactInfo}
                                onChange={e => setData({ ...data, contactInfo: e.target.value })}
                                placeholder={t('adopter.placeholder_contact')}
                            />
                        ) : (
                            <div
                                className="w-full p-4 rounded-xl border border-emerald-200 bg-white text-emerald-900 font-medium leading-relaxed min-h-[60px] cursor-pointer hover:border-emerald-400 transition-colors"
                                style={{ overflowWrap: 'anywhere' }}
                                onClick={handleClickToEdit}
                                title={t('common.edit') || 'Click to edit'}
                            >
                                {renderTextWithLinks(data.contactInfo, 'text')}
                            </div>
                        )}
                    </div>



                    {/* Family Members (Full Width) */}
                    <div className="md:col-span-2">
                        <h3 className="text-sm font-bold text-emerald-800 mb-3 uppercase tracking-wider">{t('adopter.family_members')}</h3>
                        {isEditing ? (
                            <textarea
                                rows={2}
                                className="w-full p-4 rounded-xl border border-emerald-200 bg-white text-emerald-900 placeholder-emerald-800/40 font-medium focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all outline-none resize-y min-h-[60px]"
                                value={data.familyMembers}
                                onChange={e => setData({ ...data, familyMembers: e.target.value })}
                                placeholder={t('adopter.placeholder_family')}
                            />
                        ) : (
                            data.familyMembers ? (
                                <div
                                    className="w-full p-4 rounded-xl border border-emerald-200 bg-white text-emerald-900 font-medium leading-relaxed min-h-[60px] cursor-pointer hover:border-emerald-400 transition-colors"
                                    style={{ overflowWrap: 'anywhere' }}
                                    onClick={handleClickToEdit}
                                    title={t('common.edit') || 'Click to edit'}
                                >
                                    {renderTextWithLinks(data.familyMembers, 'text')}
                                </div>
                            ) : (
                                <div
                                    className="text-stone-400 italic p-4 rounded-xl border border-dashed border-emerald-200 bg-white cursor-pointer hover:border-emerald-400 transition-colors"
                                    onClick={handleClickToEdit}
                                    title={t('common.edit') || 'Click to edit'}
                                >
                                    {t('adopter.no_family')}
                                </div>
                            )
                        )}
                    </div>

                    {/* Notes (Full Width) */}
                    <div className="md:col-span-2">
                        <h3 className="text-sm font-bold text-emerald-800 mb-3 uppercase tracking-wider">{t('adopter.notes') || 'Notes'}</h3>
                        {isEditing ? (
                            <textarea
                                rows={3}
                                className="w-full p-4 rounded-xl border border-emerald-200 bg-white text-emerald-900 placeholder-emerald-800/40 font-medium focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all outline-none resize-y min-h-[80px]"
                                value={data.notes}
                                onChange={e => setData({ ...data, notes: e.target.value })}
                                placeholder={t('adopter.placeholder_notes') || 'Additional observations, age, behavior, etc.'}
                            />
                        ) : (
                            data.notes ? (
                                <div
                                    className="w-full p-4 rounded-xl border border-emerald-200 bg-white text-emerald-900 font-medium leading-relaxed min-h-[60px] cursor-pointer hover:border-emerald-400 transition-colors"
                                    style={{ overflowWrap: 'anywhere' }}
                                    onClick={handleClickToEdit}
                                    title={t('common.edit') || 'Click to edit'}
                                >
                                    {renderTextWithLinks(data.notes, 'text')}
                                </div>
                            ) : (
                                <div
                                    className="text-stone-400 italic p-4 rounded-xl border border-dashed border-emerald-200 bg-white cursor-pointer hover:border-emerald-400 transition-colors"
                                    onClick={handleClickToEdit}
                                    title={t('common.edit') || 'Click to edit'}
                                >
                                    {t('adopter.no_notes') || 'No notes.'}
                                </div>
                            )
                        )}
                    </div>
                </div>
            </form>

            {/* MERGED HISTORY LOG */}
            {history && history.length > 0 && !isEditing && (
                <CollapsibleSection
                    title={t('audit.log_title')}
                    count={history.length}
                    defaultOpen={false}
                    className="border-t border-emerald-100/60 rounded-none shadow-none border-x-0 border-b-0"
                >
                    <div className="space-y-6 pb-6">
                        {history.map((h) => {
                            let changes = null;
                            let eventType = 'update';
                            try {
                                const parsed = JSON.parse(h.changes as string);
                                // Determine event type and data
                                if (parsed.adoption_updated) {
                                    eventType = 'adoption_updated';
                                    changes = parsed.adoption_updated;
                                } else if (parsed.adoption_added) {
                                    eventType = 'adoption_added';
                                    changes = parsed.adoption_added;
                                } else if (parsed.adoption_deleted) {
                                    eventType = 'adoption_deleted';
                                    changes = parsed.adoption_deleted;
                                } else if (parsed.image_deleted) {
                                    eventType = 'image_deleted';
                                    changes = parsed.image_deleted;
                                } else {
                                    // Fallback for old/direct profile updates
                                    changes = parsed;
                                }
                            } catch (e) { console.warn('[AdopterForm] Failed to parse history changes', e); }

                            return (
                                <div key={h.id} className="text-sm border-l-4 border-emerald-200 pl-4 py-3 bg-emerald-50/30 rounded-r-lg mb-2">
                                    <div className="flex justify-between items-start mb-2">
                                        <div className="flex items-center gap-2">
                                            <span className="text-emerald-600/70 text-xs font-bold uppercase tracking-wider">
                                                {formatDateTime(new Date(h.changedAt))}
                                            </span>
                                            {/* Badge for event type */}
                                            {eventType === 'adoption_added' && <span className="bg-emerald-100 text-emerald-700 text-[10px] px-2 py-0.5 rounded-full font-bold uppercase">{t('audit.event_adoption_added')}</span>}
                                            {eventType === 'adoption_deleted' && <span className="bg-rose-100 text-rose-700 text-[10px] px-2 py-0.5 rounded-full font-bold uppercase">{t('audit.event_adoption_deleted')}</span>}
                                            {eventType === 'image_deleted' && <span className="bg-rose-100 text-rose-700 text-[10px] px-2 py-0.5 rounded-full font-bold uppercase">{t('audit.event_image_deleted')}</span>}
                                        </div>
                                        <span className="text-xs px-2.5 py-0.5 bg-white border border-emerald-100 rounded-full text-emerald-700 font-medium shadow-sm">
                                            {t('audit.by')} {h.changedBy || t('common.anonymous')}
                                        </span>
                                    </div>

                                    <div className="space-y-1.5">
                                        {changes ? (
                                            <>
                                                {/* Profile Updates / Adoption Updates (Diffs) */}
                                                {(eventType === 'update' || eventType === 'adoption_updated') && Object.entries(changes).map(([key, delta]: [string, any]) => (
                                                    <div key={key} className="grid grid-cols-[120px_1fr] gap-3 items-start text-sm">
                                                        <span className="font-bold text-emerald-800 capitalize truncate" title={key}>{key.replace(/([A-Z])/g, ' $1').trim()}:</span>
                                                        <div className="text-emerald-700 break-words font-medium">
                                                            <div className="line-through text-rose-400 text-xs mr-2 opacity-70 inline-block">
                                                                {typeof delta.from === 'string' && delta.from.length > 30 ? delta.from.substring(0, 30) + '...' : (delta.from || t('audit.empty_val'))}
                                                            </div>
                                                            <span className="text-emerald-300 mr-2">➜</span>
                                                            <span className="text-emerald-900 bg-emerald-100/50 px-1.5 rounded">
                                                                {delta.to || t('audit.empty_val')}
                                                            </span>
                                                        </div>
                                                    </div>
                                                ))}

                                                {/* Added Adoption (Snapshot) */}
                                                {eventType === 'adoption_added' && (
                                                    <div className="text-emerald-800 font-medium">
                                                        {t('audit.desc_adoption_added')} <span className="font-bold">{changes.animalName}</span> ({changes.species}) - {changes.status}
                                                    </div>
                                                )}

                                                {/* Deleted Adoption (Snapshot) */}
                                                {eventType === 'adoption_deleted' && (
                                                    <div className="space-y-1 text-emerald-800/80">
                                                        <div><span className="font-bold">{t('adoption.animal_name')}:</span> {changes.animalName} ({changes.species})</div>
                                                        <div><span className="font-bold">{t('adoption.status')}:</span> {changes.status}</div>
                                                        <div className="flex items-center gap-1"><span className="font-bold">{t('adoption.rating')}:</span> <StarRating value={changes.rating} size="sm" showLabel /></div>
                                                        {changes.details && <div className="text-xs italic mt-1">"{changes.details}"</div>}
                                                    </div>
                                                )}

                                                {/* Deleted Image */}
                                                {eventType === 'image_deleted' && (
                                                    <div className="text-emerald-800">
                                                        {t('audit.desc_image_deleted')} <span className="italic opacity-75">"{changes.caption || t('common.untitled')}"</span> ({t('audit.by')} {formatShortDate(new Date(changes.uploadedAt))})
                                                    </div>
                                                )}
                                            </>
                                        ) : (
                                            <span className="text-emerald-400 italic text-xs">{t('audit.metadata_update')}</span>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </CollapsibleSection>
            )}
        </div>
    );
}
