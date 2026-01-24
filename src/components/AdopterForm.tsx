'use client';

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveAdopter } from "@/app/actions";
import { useLanguage } from "@/context/LanguageContext";
import { RatingBadge } from '@/components/RatingBadge';
import { CollapsibleSection } from '@/components/CollapsibleSection';

export function AdopterForm({ initialData, history = [] }: { initialData?: any, history?: any[] }) {
    const router = useRouter();
    const { t } = useLanguage();
    const isNew = !initialData?.id;

    const [isEditing, setIsEditing] = useState(isNew);
    const [loading, setLoading] = useState(false);

    const [data, setData] = useState({
        id: initialData?.id || '',
        name: initialData?.name || '',
        status: initialData?.status || '5', // Default to 5 stars
        contactInfo: initialData?.contactInfo || '',
        addressInfo: initialData?.addressInfo || '',
    });

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            const res = await saveAdopter(data);
            if (res.success) {
                if (isNew) {
                    router.push(`/adopter/${res.id}`);
                } else {
                    setIsEditing(false);
                    router.refresh();
                }
            } else {
                alert("Failed to save");
            }
        } catch (err) {
            console.error(err);
            alert("An error occurred while saving");
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
                addressInfo: initialData?.addressInfo || '',
            });
            setIsEditing(false);
        }
    };

    // Helper to render clickable links in text
    const renderTextWithLinks = (text: string) => {
        if (!text) return <span className="text-emerald-900/40 italic">{t('audit.empty_val')}</span>;

        return text.split('\n').map((line, i) => (
            <div key={i} className="min-h-[1.5em]">
                {line.split(' ').map((word, j) => {
                    if (word.match(/^(http|https):\/\//) || word.match(/^www\./)) {
                        const href = word.startsWith('www') ? `https://${word}` : word;
                        return <a key={j} href={href} target="_blank" rel="noopener noreferrer" className="text-emerald-600 hover:underline mr-1">{word}</a>;
                    }
                    if (word.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
                        return <a key={j} href={`mailto:${word}`} className="text-emerald-600 hover:underline mr-1">{word}</a>;
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
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-emerald-100/60 pb-5 mb-5 gap-4">
                    {/* ... (keep header content: Name, Status, Buttons) ... */}
                    {/* Left: Name (Identity) */}
                    <div className="flex-1 w-full md:w-auto">
                        {isEditing ? (
                            <input
                                type="text"
                                required
                                className="w-full text-2xl font-bold text-emerald-900 bg-transparent border-b-2 border-emerald-200 focus:border-emerald-500 outline-none px-1 py-1 placeholder-emerald-900/30 transition-all"
                                value={data.name}
                                onChange={e => setData({ ...data, name: e.target.value })}
                                placeholder={t('adopter.placeholder_name')}
                                autoFocus
                            />
                        ) : (
                            <h2 className="text-2xl font-bold text-emerald-900 tracking-tight px-1 py-1 border-b-2 border-transparent">
                                {data.name}
                            </h2>
                        )}
                    </div>

                    {/* Right: Actions & Status */}
                    <div className="flex items-center gap-4 w-full md:w-auto justify-between md:justify-end">

                        {/* Status Select/Badge */}
                        {isEditing ? (
                            <div className="relative">
                                <select
                                    className={`appearance-none pl-4 pr-10 py-2 text-sm font-bold rounded-full border border-emerald-200 cursor-pointer focus:ring-4 focus:ring-emerald-500/20 transition-all duration-200 shadow-sm outline-none bg-emerald-50 text-emerald-900 hover:bg-emerald-100`}
                                    value={data.status}
                                    onChange={(e) => setData({ ...data, status: e.target.value })}
                                >
                                    <option value="5">5 - {t('adopter.status_5')}</option>
                                    <option value="4">4 - {t('adopter.status_4')}</option>
                                    <option value="3">3 - {t('adopter.status_3')}</option>
                                    <option value="2">2 - {t('adopter.status_2')}</option>
                                    <option value="1">1 - {t('adopter.status_1')}</option>
                                </select>
                                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 opacity-50 text-emerald-800">
                                    <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                                </div>
                            </div>
                        ) : (
                            <RatingBadge rating={data.status} />
                        )}

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
                                onClick={() => setIsEditing(true)}
                                className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                {t('common.edit')}
                            </button>
                        )}
                    </div>
                </div>

                {/* SHARED CONTENT GRID */}
                <div className={`grid md:grid-cols-2 gap-5 ${isEditing ? 'opacity-100' : 'opacity-90'}`}>
                    {/* Contact Info */}
                    <div>
                        <h3 className="text-sm font-bold text-emerald-800 mb-3 uppercase tracking-wider">{t('adopter.contact')}</h3>
                        {isEditing ? (
                            <textarea
                                rows={3}
                                className="w-full p-4 rounded-xl border border-emerald-200 bg-white text-emerald-900 placeholder-emerald-800/40 font-medium focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all outline-none resize-y min-h-[120px]"
                                value={data.contactInfo}
                                onChange={e => setData({ ...data, contactInfo: e.target.value })}
                                placeholder={t('adopter.placeholder_contact')}
                            />
                        ) : (
                            <div className="text-emerald-900/80 leading-relaxed font-medium bg-emerald-50/30 p-4 rounded-xl border border-emerald-100/50 min-h-[120px]">
                                {renderTextWithLinks(data.contactInfo)}
                            </div>
                        )}
                    </div>

                    {/* Address Info */}
                    <div>
                        <h3 className="text-sm font-bold text-emerald-800 mb-3 uppercase tracking-wider">{t('adopter.address')}</h3>
                        {isEditing ? (
                            <textarea
                                rows={3}
                                className="w-full p-4 rounded-xl border border-emerald-200 bg-white text-emerald-900 placeholder-emerald-800/40 font-medium focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all outline-none resize-y min-h-[120px]"
                                value={data.addressInfo}
                                onChange={e => setData({ ...data, addressInfo: e.target.value })}
                                placeholder={t('adopter.placeholder_address')}
                            />
                        ) : (
                            <div className="text-emerald-900/80 leading-relaxed font-medium bg-emerald-50/30 p-4 rounded-xl border border-emerald-100/50 min-h-[120px]">
                                {renderTextWithLinks(data.addressInfo)}
                            </div>
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
                    <div className="space-y-6">
                        {history.map((h) => {
                            let changes = null;
                            try {
                                changes = JSON.parse(h.changes as string);
                            } catch (e) { }

                            return (
                                <div key={h.id} className="text-sm border-l-4 border-emerald-200 pl-4 py-1">
                                    <div className="flex justify-between items-start mb-1">
                                        <span className="text-emerald-600/70 text-xs font-bold uppercase tracking-wider">
                                            {new Date(h.changedAt).toLocaleString()}
                                        </span>
                                        <span className="text-xs px-2.5 py-0.5 bg-emerald-100 rounded-full text-emerald-700 font-medium">
                                            {t('audit.by')} {h.changedBy || 'anonymous'}
                                        </span>
                                    </div>

                                    <div className="mt-2 space-y-2">
                                        {changes ? (
                                            Object.entries(changes).map(([key, delta]: [string, any]) => (
                                                <div key={key} className="grid grid-cols-[100px_1fr] gap-3 items-start">
                                                    <span className="font-bold text-emerald-800 capitalize">{key}:</span>
                                                    <div className="text-emerald-700 break-words font-medium">
                                                        <div className="line-through text-rose-400 text-xs mb-0.5 bg-rose-50 inline-block px-1.5 rounded decoration-2">
                                                            {typeof delta.from === 'string' && delta.from.length > 50
                                                                ? delta.from.substring(0, 50) + '...'
                                                                : (delta.from || t('audit.empty_val'))}
                                                        </div>
                                                        <div className="text-emerald-400 ml-2 inline-block font-bold">→</div>
                                                        <div className="text-emerald-900 bg-emerald-100 inline-block px-1.5 rounded ml-2 shadow-sm border border-emerald-200/50">
                                                            {delta.to || t('audit.empty_val')}
                                                        </div>
                                                    </div>
                                                </div>
                                            ))
                                        ) : (
                                            <span className="text-emerald-400 italic">{t('audit.metadata_update')}</span>
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

