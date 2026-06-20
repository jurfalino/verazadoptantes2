'use client';

import { useRouter } from 'next/navigation';

interface UserOption {
    email: string;
    count: number;
}

interface UserFilterSelectProps {
    /** Discriminator: which URL param this dropdown writes to. */
    kind: 'created_by' | 'updated_by';
    /** Users with counts — already sorted by the server. */
    users: UserOption[];
    /** Currently-selected user email for this kind, or undefined. */
    currentUser?: string;
    /** Whole current URL-param set so we preserve everything else on change. */
    preserved: {
        q?: string;
        country?: string;
        rating?: string;
        created_by?: string;
        updated_by?: string;
        visibility?: string;
        sort?: string;
    };
    /** Visible label inside the empty option ("All creators" / "All editors"). */
    allLabel: string;
}

/**
 * Client component for the /admin/adopters per-user filter (created_by or
 * updated_by). v2.19.61: split from the previous combined Created/Updated
 * dropdown into two independent facets, with counts inline in each option.
 */
export default function UserFilterSelect({
    kind,
    users,
    currentUser,
    preserved,
    allLabel,
}: UserFilterSelectProps) {
    const router = useRouter();

    const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const next: Record<string, string | undefined> = { ...preserved };
        next[kind] = e.target.value || undefined;
        const qs = Object.entries(next)
            .filter(([, v]) => v !== undefined && v !== '')
            .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
            .join('&');
        router.push(`/admin/adopters${qs ? `?${qs}` : ''}`);
    };

    return (
        <select
            value={currentUser || ''}
            onChange={handleChange}
            className="flex-1 px-3 py-1.5 rounded-lg border border-stone-200 text-sm text-stone-700 bg-white max-w-xs"
        >
            <option value="">{allLabel}</option>
            {users.map((u) => (
                <option key={u.email} value={u.email}>
                    {u.email} ({u.count})
                </option>
            ))}
        </select>
    );
}
