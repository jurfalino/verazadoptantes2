'use client';

import { useRouter } from 'next/navigation';

interface UserFilterSelectProps {
    users: string[];
    currentUser?: string;
    query?: string;
    filterCountry?: string;
    filterRating?: string;
}

/**
 * Client component for the /admin/adopters "Created / Updated by" filter.
 *
 * Replaces an earlier inline-script + dangerouslySetInnerHTML implementation in
 * the page server component (v2.14.8-5 and earlier) — that pattern was fragile
 * under App Router hydration: the inline `addEventListener` ran once at parse
 * time, but the listener would be lost or never re-attached after hydration,
 * which is why selecting a user did nothing. A proper React `onChange` handler
 * with `useRouter().push()` is the right shape.
 */
export default function UserFilterSelect({
    users,
    currentUser,
    query,
    filterCountry,
    filterRating,
}: UserFilterSelectProps) {
    const router = useRouter();

    const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const params = new URLSearchParams();
        if (query) params.set('q', query);
        if (filterCountry) params.set('country', filterCountry);
        if (filterRating) params.set('rating', filterRating);
        if (e.target.value) params.set('user', e.target.value);
        const qs = params.toString();
        router.push(`/admin/adopters${qs ? `?${qs}` : ''}`);
    };

    return (
        <select
            value={currentUser || ''}
            onChange={handleChange}
            className="flex-1 px-3 py-1.5 rounded-lg border border-stone-200 text-sm text-stone-700 bg-white max-w-xs"
        >
            <option value="">All users</option>
            {users.map(u => (
                <option key={u} value={u}>{u}</option>
            ))}
        </select>
    );
}
