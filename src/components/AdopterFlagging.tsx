'use client';

import { useState } from 'react';
import { flagAdopter, searchAdopter } from '@/app/actions';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';

export function AdopterFlagging({ adopterId, adopterName, existingFlags }: { adopterId: string, adopterName: string, existingFlags: any[] }) {
    const router = useRouter();
    const { t } = useLanguage();
    const [isOpen, setIsOpen] = useState(false);
    const [reason, setReason] = useState('duplicate');
    const [details, setDetails] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [targetAdopter, setTargetAdopter] = useState<any>(null);
    const [loading, setLoading] = useState(false);

    // Filter duplicates from existing flags
    const duplicateFlags = existingFlags.filter(f => f.reason === 'duplicate');
    const isFlaggedAsDuplicate = duplicateFlags.length > 0;

    const handleSearch = async () => {
        if (!searchTerm.trim()) return;
        const res = await searchAdopter(searchTerm);
        // Exclude current adopter
        setSearchResults(res.filter(r => r.adopter.id !== adopterId));
    };

    const handleSubmit = async () => {
        setLoading(true);
        try {
            await flagAdopter(
                adopterId,
                reason,
                details,
                targetAdopter?.id
            );
            setIsOpen(false);
            router.refresh();
        } catch (error) {
            console.error(error);
            alert("Failed to save report");
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            {/* Warning Banner */}
            {isFlaggedAsDuplicate && (
                <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-6">
                    <div className="flex">
                        <div className="flex-shrink-0">
                            <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                            </svg>
                        </div>
                        <div className="ml-3">
                            <p className="text-sm text-yellow-700">
                                {t('flagging.banner_duplicate')}
                                {duplicateFlags[0].targetAdopterId && (
                                    <span> {t('flagging.banner_check')} <a href={`/adopter/${duplicateFlags[0].targetAdopterId}`} className="font-medium underline hover:text-yellow-600">{t('flagging.check_link')}</a>.</span>
                                )}
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* Header Button */}
            <div className="absolute top-0 right-0 mt-4 mr-4">
                <button
                    onClick={() => setIsOpen(true)}
                    className="text-gray-500 hover:text-red-600 font-medium text-sm flex items-center gap-1"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21v-8a2 2 0 012-2h10a2 2 0 012 2v6l-3-2-3 2-3-2-3 2zm4-8V5a2 2 0 012-2h6a2 2 0 012 2v2m-6 9l2-2 2 2" />
                    </svg>
                    {t('flagging.report_merge')}
                </button>
            </div>

            {/* Modal */}
            {isOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
                        <h3 className="text-lg font-bold mb-4">{t('flagging.report_title')} {adopterName}</h3>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium mb-1">{t('flagging.reason')}</label>
                                <select
                                    className="w-full border rounded p-2"
                                    value={reason}
                                    onChange={e => setReason(e.target.value)}
                                >
                                    <option value="duplicate">{t('flagging.reason_duplicate')}</option>
                                    <option value="fake">{t('flagging.reason_fake')}</option>
                                    <option value="abusive">{t('flagging.reason_abusive')}</option>
                                </select>
                            </div>

                            {reason === 'duplicate' && (
                                <div className="p-4 bg-gray-50 rounded border">
                                    <label className="block text-sm font-medium mb-2">{t('flagging.find_original')}</label>
                                    <div className="flex gap-2 mb-2">
                                        <input
                                            className="flex-1 border rounded p-2 text-sm"
                                            placeholder={t('flagging.search_placeholder')}
                                            value={searchTerm}
                                            onChange={e => setSearchTerm(e.target.value)}
                                            onKeyDown={e => e.key === 'Enter' && handleSearch()}
                                        />
                                        <button onClick={handleSearch} className="bg-gray-200 px-3 rounded text-sm hover:bg-gray-300">
                                            {t('common.search')}
                                        </button>
                                    </div>

                                    {searchResults.length > 0 && (
                                        <div className="max-h-40 overflow-y-auto space-y-2 mb-2">
                                            {searchResults.map(res => (
                                                <div
                                                    key={res.adopter.id}
                                                    className={`p-2 border rounded cursor-pointer text-sm ${targetAdopter?.id === res.adopter.id ? 'bg-blue-50 border-blue-500' : 'hover:bg-white'}`}
                                                    onClick={() => setTargetAdopter(res.adopter)}
                                                >
                                                    <div className="font-bold">{res.adopter.name}</div>
                                                    <div className="text-gray-500 truncate">{res.adopter.email || res.adopter.phone}</div>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {targetAdopter && (
                                        <div className="text-sm text-green-600 font-medium">
                                            {t('flagging.selected_original')}: {targetAdopter.name}
                                        </div>
                                    )}
                                </div>
                            )}

                            <div>
                                <label className="block text-sm font-medium mb-1">{t('flagging.details')}</label>
                                <textarea
                                    className="w-full border rounded p-2 text-sm"
                                    rows={3}
                                    value={details}
                                    onChange={e => setDetails(e.target.value)}
                                    placeholder={t('flagging.details_placeholder')}
                                />
                            </div>

                            <div className="flex justify-end gap-2 pt-2">
                                <button
                                    onClick={() => setIsOpen(false)}
                                    className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded"
                                >
                                    {t('common.cancel')}
                                </button>
                                <button
                                    onClick={handleSubmit}
                                    disabled={loading || (reason === 'duplicate' && !targetAdopter)}
                                    className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                                >
                                    {loading ? t('flagging.submitting') : t('flagging.submit')}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
