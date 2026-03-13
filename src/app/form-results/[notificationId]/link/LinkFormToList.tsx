'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { linkFormSubmissionToAdopter } from '@/app/actions/formSubmission';

interface AdopterItem {
    id: string;
    name: string;
}

export default function LinkFormToList({
    submissionId,
    adopters,
}: {
    submissionId: string;
    adopters: AdopterItem[];
}) {
    const router = useRouter();
    const [linkingId, setLinkingId] = useState<string | null>(null);

    const handleLink = async (adopterId: string) => {
        setLinkingId(adopterId);
        try {
            const result = await linkFormSubmissionToAdopter(submissionId, adopterId);
            if (result.success) {
                router.push(`/adopter/${adopterId}`);
                router.refresh();
            } else {
                setLinkingId(null);
                alert(result.error || 'No se pudo vincular');
            }
        } catch {
            setLinkingId(null);
            alert('Error al vincular');
        }
    };

    if (adopters.length === 0) {
        return (
            <p className="text-sm text-stone-500 py-4">
                No tenés perfiles de adoptantes todavía. Creá uno desde las respuestas del formulario.
            </p>
        );
    }

    return (
        <ul className="space-y-2">
            {adopters.map((a) => (
                <li
                    key={a.id}
                    className="flex items-center justify-between gap-4 bg-white border border-stone-200 rounded-xl p-4"
                >
                    <span className="font-medium text-stone-800 truncate">{a.name}</span>
                    <button
                        type="button"
                        onClick={() => handleLink(a.id)}
                        disabled={!!linkingId}
                        className="flex-shrink-0 px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50"
                    >
                        {linkingId === a.id ? 'Vinculando…' : 'Vincular'}
                    </button>
                </li>
            ))}
        </ul>
    );
}
