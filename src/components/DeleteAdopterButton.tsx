'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface DeleteButtonProps {
    adopterId: string;
    adopterName: string;
}

export default function DeleteAdopterButton({ adopterId, adopterName }: DeleteButtonProps) {
    const [loading, setLoading] = useState(false);
    const router = useRouter();

    const handleDelete = async () => {
        if (!confirm(`Are you sure you want to permanently delete "${adopterName}" and all related data?`)) {
            return;
        }

        setLoading(true);
        try {
            const response = await fetch('/api/admin/delete-adopter', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ adopterId }),
            });

            const data = await response.json() as { success?: boolean; error?: string };

            if (data.success) {
                router.refresh();
            } else {
                alert(`Delete failed: ${data.error || 'Unknown error'}`);
            }
        } catch (error) {
            console.error('Delete error:', error);
            alert('Delete failed - check console');
        } finally {
            setLoading(false);
        }
    };

    return (
        <button
            onClick={handleDelete}
            disabled={loading}
            className="px-3 py-1.5 text-xs font-bold text-rose-600 bg-rose-100 rounded-lg hover:bg-rose-200 transition-colors disabled:opacity-50"
            title="Permanently Delete Adopter"
        >
            {loading ? '...' : 'Delete'}
        </button>
    );
}
