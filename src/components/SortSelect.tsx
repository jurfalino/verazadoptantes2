'use client';

import { useRouter } from 'next/navigation';

interface SortSelectProps {
    /** Currently-active sort key or undefined (= default `updated_desc`). */
    currentSort?: string;
    /** Other URL params we preserve on change. */
    preserved: {
        q?: string;
        country?: string;
        rating?: string;
        created_by?: string;
        updated_by?: string;
        visibility?: string;
        sort?: string;
    };
}

const OPTIONS: { value: string; label: string }[] = [
    { value: 'updated_desc', label: 'Updated (newest)' },
    { value: 'updated_asc', label: 'Updated (oldest)' },
    { value: 'created_desc', label: 'Created (newest)' },
    { value: 'created_asc', label: 'Created (oldest)' },
    { value: 'name_asc', label: 'Name (A–Z)' },
    { value: 'name_desc', label: 'Name (Z–A)' },
    { value: 'rating_desc', label: 'Rating (high → low)' },
    { value: 'rating_asc', label: 'Rating (low → high)' },
];

export default function SortSelect({ currentSort, preserved }: SortSelectProps) {
    const router = useRouter();

    const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const value = e.target.value;
        const next: Record<string, string | undefined> = { ...preserved };
        // Omit `sort` when the user picks the default — keeps URLs clean.
        next.sort = value === 'updated_desc' ? undefined : value;
        const qs = Object.entries(next)
            .filter(([, v]) => v !== undefined && v !== '')
            .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
            .join('&');
        router.push(`/admin/adopters${qs ? `?${qs}` : ''}`);
    };

    return (
        <select
            value={currentSort || 'updated_desc'}
            onChange={handleChange}
            className="flex-1 px-3 py-1.5 rounded-lg border border-stone-200 text-sm text-stone-700 bg-white max-w-xs"
        >
            {OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                    {o.label}
                </option>
            ))}
        </select>
    );
}
