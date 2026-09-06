// Record type color utility - provides consistent colors for each record type across the app
export type RecordType = 'adoption' | 'adoption_request' | 'observation' | 'follow_up' | 'returned_pet' | 'foster';

export type RecordTypeColors = { bg: string; text: string; border: string; dot: string; ring: string; iconBg: string };

export function getRecordTypeColors(recordType: string): RecordTypeColors {
    const colors: Record<string, RecordTypeColors> = {
        adoption: { bg: 'bg-teal-100', text: 'text-teal-700', border: 'border-teal-200', dot: 'bg-teal-500', ring: 'ring-teal-200', iconBg: 'bg-teal-100' },
        adoption_request: { bg: 'bg-sky-100', text: 'text-sky-700', border: 'border-sky-200', dot: 'bg-sky-500', ring: 'ring-sky-200', iconBg: 'bg-sky-100' },
        observation: { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-200', dot: 'bg-amber-500', ring: 'ring-amber-200', iconBg: 'bg-amber-100' },
        follow_up: { bg: 'bg-violet-100', text: 'text-violet-700', border: 'border-violet-200', dot: 'bg-violet-500', ring: 'ring-violet-200', iconBg: 'bg-violet-100' },
        returned_pet: { bg: 'bg-rose-100', text: 'text-rose-700', border: 'border-rose-200', dot: 'bg-rose-500', ring: 'ring-rose-200', iconBg: 'bg-rose-100' },
        foster: { bg: 'bg-indigo-100', text: 'text-indigo-700', border: 'border-indigo-200', dot: 'bg-indigo-500', ring: 'ring-indigo-200', iconBg: 'bg-indigo-100' },
    };

    // Default to teal (adoption) for unknown types
    return colors[recordType] || colors['adoption'];
}

// Animal care events (animal_events.event_type) — a SEPARATE map so the
// RecordType union above doesn't widen (that union is mirrored in ~6 places).
export function getAnimalEventColors(eventType: string): RecordTypeColors {
    const colors: Record<string, RecordTypeColors> = {
        vaccination: { bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-500', ring: 'ring-emerald-200', iconBg: 'bg-emerald-100' },
        deworming: { bg: 'bg-lime-100', text: 'text-lime-700', border: 'border-lime-200', dot: 'bg-lime-500', ring: 'ring-lime-200', iconBg: 'bg-lime-100' },
        vet_visit: { bg: 'bg-cyan-100', text: 'text-cyan-700', border: 'border-cyan-200', dot: 'bg-cyan-500', ring: 'ring-cyan-200', iconBg: 'bg-cyan-100' },
        neuter: { bg: 'bg-fuchsia-100', text: 'text-fuchsia-700', border: 'border-fuchsia-200', dot: 'bg-fuchsia-500', ring: 'ring-fuchsia-200', iconBg: 'bg-fuchsia-100' },
        note: { bg: 'bg-stone-100', text: 'text-stone-600', border: 'border-stone-200', dot: 'bg-stone-400', ring: 'ring-stone-200', iconBg: 'bg-stone-100' },
    };
    return colors[eventType] || colors['note'];
}

// Get the emoji icon for each record type
export function getRecordTypeIcon(recordType: string): string {
    const icons: Record<string, string> = {
        adoption: '🏠',
        adoption_request: '📝',
        observation: '👁️',
        follow_up: '🔄',
        returned_pet: '↩️',
        foster: '🤝',
    };
    return icons[recordType] || '📋';
}
