'use client';

import { useState } from 'react';
import { purgeAllData } from '@/app/actions';
import { useRouter } from 'next/navigation';

export default function AdminDangerZone() {
    const router = useRouter();
    const [showConfirm, setShowConfirm] = useState(false);
    const [step, setStep] = useState(1);
    const [confirmInput, setConfirmInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const CONFIRMATION_CODE = 'PURGE-ALL-DATA';

    const handleFirstConfirm = () => {
        setStep(2);
    };

    const handleFinalConfirm = async () => {
        if (confirmInput !== CONFIRMATION_CODE) {
            setError(`Type "${CONFIRMATION_CODE}" exactly to confirm`);
            return;
        }

        setLoading(true);
        setError('');
        try {
            await purgeAllData(confirmInput);
            alert('All data has been purged successfully.');
            setShowConfirm(false);
            setStep(1);
            setConfirmInput('');
            router.refresh();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to purge data');
        } finally {
            setLoading(false);
        }
    };

    const handleCancel = () => {
        setShowConfirm(false);
        setStep(1);
        setConfirmInput('');
        setError('');
    };

    return (
        <div className="bg-red-50 p-6 rounded-2xl border-2 border-red-200">
            <div className="flex items-center gap-3 mb-4">
                <span className="text-2xl">⚠️</span>
                <h3 className="text-lg font-bold text-red-800">Danger Zone</h3>
            </div>

            {!showConfirm ? (
                <div className="space-y-4">
                    <p className="text-red-700 text-sm">
                        Permanently delete <strong>ALL</strong> data including adopters, adoptions, images, flags, and history.
                        This action cannot be undone.
                    </p>
                    <button
                        onClick={() => setShowConfirm(true)}
                        className="px-4 py-2 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 transition-colors"
                    >
                        🗑️ Purge All Data
                    </button>
                </div>
            ) : (
                <div className="space-y-4">
                    {step === 1 && (
                        <>
                            <div className="bg-red-100 p-4 rounded-lg border border-red-300">
                                <p className="text-red-800 font-bold mb-2">⚠️ First Confirmation</p>
                                <p className="text-red-700 text-sm">
                                    Are you absolutely sure you want to delete ALL data?
                                    This will permanently remove:
                                </p>
                                <ul className="text-red-700 text-sm mt-2 ml-4 list-disc">
                                    <li>All adopters and their profiles</li>
                                    <li>All adoption records</li>
                                    <li>All images</li>
                                    <li>All flags and verifications</li>
                                    <li>All history logs</li>
                                    <li>All search records</li>
                                </ul>
                            </div>
                            <div className="flex gap-3">
                                <button
                                    onClick={handleCancel}
                                    className="px-4 py-2 bg-stone-200 text-stone-700 font-medium rounded-lg hover:bg-stone-300 transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleFirstConfirm}
                                    className="px-4 py-2 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 transition-colors"
                                >
                                    Yes, Continue to Final Confirmation
                                </button>
                            </div>
                        </>
                    )}

                    {step === 2 && (
                        <>
                            <div className="bg-red-100 p-4 rounded-lg border border-red-300">
                                <p className="text-red-800 font-bold mb-2">🚨 Final Confirmation</p>
                                <p className="text-red-700 text-sm mb-4">
                                    Type <code className="bg-red-200 px-2 py-0.5 rounded font-mono">{CONFIRMATION_CODE}</code> to confirm permanent deletion:
                                </p>
                                <input
                                    type="text"
                                    value={confirmInput}
                                    onChange={(e) => setConfirmInput(e.target.value)}
                                    placeholder="Type confirmation code..."
                                    className="w-full px-4 py-2 rounded-lg border-2 border-red-300 font-mono focus:border-red-500 focus:ring-4 focus:ring-red-500/20 outline-none"
                                    autoFocus
                                />
                                {error && (
                                    <p className="text-red-600 text-sm mt-2 font-medium">{error}</p>
                                )}
                            </div>
                            <div className="flex gap-3">
                                <button
                                    onClick={handleCancel}
                                    className="px-4 py-2 bg-stone-200 text-stone-700 font-medium rounded-lg hover:bg-stone-300 transition-colors"
                                    disabled={loading}
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleFinalConfirm}
                                    disabled={loading || confirmInput !== CONFIRMATION_CODE}
                                    className="px-4 py-2 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {loading ? 'Purging...' : '🗑️ Permanently Delete All Data'}
                                </button>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
