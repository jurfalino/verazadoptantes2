'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useShowToast } from '@/components/ui/Toast';
import { useLanguage } from '@/context/LanguageContext';
import { extractErrorId } from '@/lib/errorUtils';

interface DeleteButtonProps {
    adopterId: string;
    adopterName: string;
}

export default function DeleteAdopterButton({ adopterId, adopterName }: DeleteButtonProps) {
    const [loading, setLoading] = useState(false);
    const router = useRouter();
    const toast = useShowToast();
    const { t } = useLanguage();

    const handleDelete = async () => {
        const confirmMsg = t('dialogs.confirm_delete_adopter').replace('{name}', adopterName);
        if (!confirm(confirmMsg)) {
            return;
        }

        setLoading(true);
        try {
            const response = await fetch('/api/admin/delete-adopter', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ adopterId }),
            });

            const data = await response.json() as { success?: boolean; error?: string; errorId?: string };

            if (data.success) {
                router.refresh();
            } else {
                toast.error(t('toast.delete_failed_title'), data.error || t('errors.unknown_error'), data.errorId);
            }
        } catch (error) {
            toast.error(t('toast.delete_failed_title'), t('errors.unexpected'), extractErrorId(error));
        } finally {
            setLoading(false);
        }
    };

    return (
        <button
            onClick={handleDelete}
            disabled={loading}
            className="px-3 py-1.5 text-xs font-semibold text-rose-600 bg-rose-100 rounded-lg hover:bg-rose-200 transition-colors disabled:opacity-50"
            title={t('admin.permanently_delete_adopter_title')}
        >
            {loading ? '...' : t('common.delete')}
        </button>
    );
}
