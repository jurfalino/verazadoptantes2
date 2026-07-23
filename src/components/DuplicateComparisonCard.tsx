'use client';

import { useState, useEffect } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { getAdopter } from '@/app/actions';
import { getAllAdopterImages } from '@/app/actions/images';
import type { Adopter } from '@/types/adopter';

interface DuplicateComparisonCardProps {
    currentAdopter: Adopter;
    currentImages: any[];
    otherAdopterId: string;
    onClose: () => void;
}

function proxyImageUrl(url: string): string {
    return url.includes('r2.dev') ? `/api/proxy-image?url=${encodeURIComponent(url)}` : url;
}

function DataRow({ label, value }: { label: string; value: string | null | undefined }) {
    if (value == null || value === '') return null;
    return (
        <div className="flex flex-col gap-0.5 py-1">
            <span className="text-xs font-medium text-stone-500">{label}</span>
            <span className="text-sm text-stone-800 break-words">{value}</span>
        </div>
    );
}

export default function DuplicateComparisonCard({ currentAdopter, currentImages, otherAdopterId, onClose }: DuplicateComparisonCardProps) {
    const { t } = useLanguage();
    const [loading, setLoading] = useState(true);
    const [otherAdopter, setOtherAdopter] = useState<Adopter | null>(null);
    const [otherImages, setOtherImages] = useState<any[]>([]);
    const [error, setError] = useState(false);

    useEffect(() => {
        let isMounted = true;
        async function fetchData() {
            try {
                setLoading(true);
                const [adopterData, imagesData] = await Promise.all([
                    getAdopter(otherAdopterId),
                    getAllAdopterImages(otherAdopterId)
                ]);
                
                if (isMounted) {
                    if (adopterData) setOtherAdopter(adopterData as Adopter);
                    else setError(true);
                    
                    if (imagesData) setOtherImages(imagesData);
                }
            } catch (e) {
                console.error('Error fetching duplicate data:', e);
                if (isMounted) setError(true);
            } finally {
                if (isMounted) setLoading(false);
            }
        }
        fetchData();
        return () => { isMounted = false; };
    }, [otherAdopterId]);

    const currentProfilePic = currentImages.find(img => img.isProfilePicture === 1) || currentImages[0];
    const otherProfilePic = otherImages.find(img => img.isProfilePicture === 1) || otherImages[0];

    return (
        <div className="mt-3 bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden animate-in slide-in-from-top-2 fade-in duration-200">
            {/* Header / Loading state */}
            <div className="flex items-center justify-between px-4 py-2 bg-stone-50 border-b border-stone-200">
                <span className="text-xs font-semibold text-stone-600 uppercase tracking-wider">
                    {t('duplicates.comparison') || 'Comparison'}
                </span>
                <button 
                    onClick={onClose}
                    className="p-1 hover:bg-stone-200 rounded-full text-stone-500 transition-colors"
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
            </div>

            {loading ? (
                <div className="p-6 flex flex-col items-center justify-center gap-2 text-stone-500">
                    <svg className="w-6 h-6 animate-spin text-teal-600" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    <span className="text-sm">{t('common.loading') || 'Loading...'}</span>
                </div>
            ) : error || !otherAdopter ? (
                <div className="p-4 text-sm text-rose-600 bg-rose-50 text-center">
                    Could not load the comparison data.
                </div>
            ) : (
                <>
                    {/* Photos */}
                    <div className="px-4 py-3 border-b border-stone-200 flex items-center justify-center gap-6 bg-stone-50/50">
                        <div className="flex flex-col items-center gap-1 w-1/2">
                            {currentProfilePic ? (
                                <img src={proxyImageUrl(currentProfilePic.url)} alt="" className="w-14 h-14 rounded-full object-cover border-2 border-teal-200 bg-stone-100" />
                            ) : (
                                <div className="w-14 h-14 rounded-full border-2 border-dashed border-teal-200 bg-stone-100 flex items-center justify-center text-stone-400 text-xs">—</div>
                            )}
                            <span className="text-xs font-medium text-teal-800 text-center truncate w-full px-2" title={currentAdopter.name}>{currentAdopter.name.split(' ')[0]} (Este Perfil)</span>
                        </div>
                        <div className="w-px h-12 bg-stone-200 flex-shrink-0"></div>
                        <div className="flex flex-col items-center gap-1 w-1/2">
                            {otherProfilePic ? (
                                <img src={proxyImageUrl(otherProfilePic.url)} alt="" className="w-14 h-14 rounded-full object-cover border-2 border-amber-200 bg-stone-100" />
                            ) : (
                                <div className="w-14 h-14 rounded-full border-2 border-dashed border-amber-200 bg-stone-100 flex items-center justify-center text-stone-400 text-xs">—</div>
                            )}
                            <span className="text-xs font-medium text-amber-800 text-center truncate w-full px-2" title={otherAdopter.name}>{otherAdopter.name.split(' ')[0]} (Posible Duplicado)</span>
                        </div>
                    </div>
                    
                    {/* Data Comparison */}
                    <div className="grid grid-cols-2 divide-x divide-stone-200 relative">
                        {/* Current Profile */}
                        <div className="p-4 bg-teal-50/30">
                            <DataRow label={t('formResults.name_label') || 'Name'} value={currentAdopter.name} />
                            <DataRow label={t('formResults.contact_section') || 'Contact'} value={currentAdopter.contactInfo} />
                            <DataRow label={t('formResults.address_label') || 'Address'} value={currentAdopter.addressInfo} />
                        </div>

                        {/* Other Profile */}
                        <div className="p-4 bg-amber-50/30">
                            <DataRow label={t('formResults.name_label') || 'Name'} value={otherAdopter.name} />
                            <DataRow label={t('formResults.contact_section') || 'Contact'} value={otherAdopter.contactInfo} />
                            <DataRow label={t('formResults.address_label') || 'Address'} value={otherAdopter.addressInfo} />
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
