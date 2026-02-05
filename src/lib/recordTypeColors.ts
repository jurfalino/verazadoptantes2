// Record type color utility - provides consistent colors for each record type across the app
export type RecordType = 'adoption' | 'adoption_request' | 'observation' | 'follow_up' | 'returned_pet';

export function getRecordTypeColors(recordType: string): { bg: string; text: string; border: string } {
    const colors: Record<string, { bg: string; text: string; border: string }> = {
        adoption: { bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-200' },
        adoption_request: { bg: 'bg-sky-100', text: 'text-sky-700', border: 'border-sky-200' },
        observation: { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-200' },
        follow_up: { bg: 'bg-violet-100', text: 'text-violet-700', border: 'border-violet-200' },
        returned_pet: { bg: 'bg-rose-100', text: 'text-rose-700', border: 'border-rose-200' },
    };

    // Default to emerald (adoption) for unknown types
    return colors[recordType] || colors['adoption'];
}

// Get the emoji icon for each record type
export function getRecordTypeIcon(recordType: string): string {
    const icons: Record<string, string> = {
        adoption: '🏠',
        adoption_request: '📝',
        observation: '👁️',
        follow_up: '🔄',
        returned_pet: '↩️',
    };
    return icons[recordType] || '📋';
}
