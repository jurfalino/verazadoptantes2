// Record type color utility - provides consistent colors for each record type across the app
export type RecordType = 'adoption' | 'adoption_request' | 'observation' | 'follow_up' | 'returned_pet';

export type RecordTypeColors = { bg: string; text: string; border: string; dot: string; ring: string; iconBg: string };

export function getRecordTypeColors(recordType: string): RecordTypeColors {
    const colors: Record<string, RecordTypeColors> = {
        adoption: { bg: 'bg-teal-100', text: 'text-teal-700', border: 'border-teal-200', dot: 'bg-teal-500', ring: 'ring-teal-200', iconBg: 'bg-teal-100' },
        adoption_request: { bg: 'bg-sky-100', text: 'text-sky-700', border: 'border-sky-200', dot: 'bg-sky-500', ring: 'ring-sky-200', iconBg: 'bg-sky-100' },
        observation: { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-200', dot: 'bg-amber-500', ring: 'ring-amber-200', iconBg: 'bg-amber-100' },
        follow_up: { bg: 'bg-violet-100', text: 'text-violet-700', border: 'border-violet-200', dot: 'bg-violet-500', ring: 'ring-violet-200', iconBg: 'bg-violet-100' },
        returned_pet: { bg: 'bg-rose-100', text: 'text-rose-700', border: 'border-rose-200', dot: 'bg-rose-500', ring: 'ring-rose-200', iconBg: 'bg-rose-100' },
    };

    // Default to teal (adoption) for unknown types
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
