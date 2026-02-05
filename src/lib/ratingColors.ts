// Rating color utility - provides gradient colors from red (1) to green (5)
export function getRatingColors(rating: number): { bg: string; text: string; border: string; ring: string } {
    const roundedRating = Math.round(rating);

    const colors: Record<number, { bg: string; text: string; border: string; ring: string }> = {
        1: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', ring: 'ring-red-100' },
        2: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', ring: 'ring-orange-100' },
        3: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', ring: 'ring-amber-100' },
        4: { bg: 'bg-lime-50', text: 'text-lime-700', border: 'border-lime-200', ring: 'ring-lime-100' },
        5: { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200', ring: 'ring-green-100' },
    };

    // Default to amber (3) for invalid ratings
    return colors[roundedRating] || colors[3];
}

// Get a simple description for the rating
export function getRatingDescription(rating: number): string {
    const roundedRating = Math.round(rating);
    const descriptions: Record<number, string> = {
        1: 'dangerous',
        2: 'poor',
        3: 'average',
        4: 'good',
        5: 'excellent',
    };
    return descriptions[roundedRating] || 'unknown';
}
