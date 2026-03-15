'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useAuthContext } from '@/context/AuthContext';
import { useShowToast } from '@/components/ui/Toast';
import { getInvitePreview, joinOrganization } from '@/app/actions/organizations';

export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
    const { data: session, status } = useSession();
    const router = useRouter();
    const { t } = useLanguage();
    const { openLogin } = useAuthContext();
    const toast = useShowToast();

    const [token, setToken] = useState<string>('');
    const [preview, setPreview] = useState<{ orgName: string; memberCount: number } | null>(null);
    const [loading, setLoading] = useState(true);
    const [joining, setJoining] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        params.then(({ token: t }) => {
            setToken(t);
            getInvitePreview(t).then((p) => {
                setPreview(p);
                setLoading(false);
                if (!p) setError(t ? 'invalid' : 'missing');
            }).catch(() => {
                setLoading(false);
                setError('invalid');
            });
        });
    }, [params]);

    useEffect(() => {
        // Auto-join if authenticated and preview is loaded
        if (status === 'authenticated' && preview && token && !joining) {
            handleJoin();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [status, preview, token]);

    const handleJoin = async () => {
        if (!token) return;
        setJoining(true);
        try {
            const result = await joinOrganization(token);
            if (result.success) {
                toast.success(t('organizations.join_success').replace('{name}', result.orgName || ''));
                router.push('/organizations');
            } else {
                setError(result.error || 'Error');
                setJoining(false);
            }
        } catch {
            setError('Error');
            setJoining(false);
        }
    };

    if (loading) {
        return (
            <main className="container mx-auto px-4 py-16 text-center">
                <p className="text-stone-500">{t('common.loading')}</p>
            </main>
        );
    }

    if (error) {
        return (
            <main className="container mx-auto px-4 py-16 text-center max-w-md">
                <p className="text-4xl mb-4">😕</p>
                <p className="text-stone-600 font-medium">
                    {error === 'invalid' ? t('organizations.invalid_invite') : error}
                </p>
                <button
                    onClick={() => router.push('/')}
                    className="mt-6 text-sm text-teal-600 hover:text-teal-700 font-medium"
                >
                    ← {t('common.back_to_search')}
                </button>
            </main>
        );
    }

    return (
        <main className="container mx-auto px-4 py-16 text-center max-w-md">
            <div className="bg-white rounded-2xl border border-stone-200 shadow-lg p-8">
                <p className="text-4xl mb-4">🏢</p>
                <h1 className="text-xl font-bold text-stone-900 mb-2">
                    {t('organizations.join_title')}
                </h1>
                <p className="text-2xl font-semibold text-teal-700 mb-1">{preview?.orgName}</p>
                <p className="text-sm text-stone-500 mb-6">
                    {t('organizations.member_count').replace('{count}', String(preview?.memberCount || 0))}
                </p>

                {status === 'authenticated' ? (
                    <button
                        onClick={handleJoin}
                        disabled={joining}
                        className="w-full px-6 py-3 bg-teal-600 text-white rounded-xl font-semibold hover:bg-teal-700 disabled:opacity-50 transition-colors"
                    >
                        {joining ? t('common.loading') : t('organizations.join_button')}
                    </button>
                ) : (
                    <button
                        onClick={() => openLogin(`/invite/${token}`)}
                        className="w-full px-6 py-3 bg-teal-600 text-white rounded-xl font-semibold hover:bg-teal-700 transition-colors"
                    >
                        {t('nav.sign_in')} & {t('organizations.join_button')}
                    </button>
                )}
            </div>
        </main>
    );
}
