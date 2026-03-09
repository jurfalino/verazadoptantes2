'use client';

import { useLanguage } from '@/context/LanguageContext';

interface ContactPill {
    type: 'phone' | 'email' | 'url' | 'document' | 'address' | 'social' | 'other';
    value: string;
    display: string;
}

interface ContactPillsProps {
    text: string;
    showIcons?: boolean;
}

function parseContactInfo(text: string): ContactPill[] {
    if (!text) return [];

    const pills: ContactPill[] = [];
    const usedRanges: Array<[number, number]> = [];

    // Helper to check if range overlaps with already-used ranges
    const isRangeUsed = (start: number, end: number) =>
        usedRanges.some(([s, e]) => !(end <= s || start >= e));

    const markUsed = (start: number, end: number) =>
        usedRanges.push([start, end]);

    // ============ PATTERNS (order matters - more specific first) ============

    // Email: standard email pattern
    const emailRegex = /[\w.+-]+@[\w.-]+\.\w{2,}/gi;

    // URL: http/https/www links
    const urlRegex = /(?:https?:\/\/|www\.)[^\s<>"\]]+/gi;

    // Social media handles: @username or platform-specific
    const socialRegex = /@[\w.]{2,30}(?:\s|$)|(?:instagram|ig|facebook|fb|twitter|tiktok|whatsapp|wa|telegram|tg)[:\s]*@?[\w.]+/gi;

    // Document IDs: DNI, CUIL, CUIT, CI, RUT, passport patterns (Argentina & Latin America)
    // Formats: DNI 12345678, CUIL 20-12345678-9, CI: 1.234.567-8
    const docRegex = /(?:dni|cuil|cuit|ci|rut|cedula|pasaporte|passport|documento)[:\s#.-]*[\d\s.-]{6,15}/gi;

    // Phone: More precise patterns
    // +54 9 11 1234-5678, (011) 1234-5678, 15-1234-5678, +1 (555) 123-4567
    const phoneRegex = /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{4,6}/g;

    // Address keywords that indicate an address line
    const addressKeywords = /(?:calle|av\.?|avenida|piso|depto?\.?|departamento|barrio|localidad|ciudad|cp|c\.?p\.?|código postal|pcia\.?|provincia|nro?\.?|número|entre|esquina|altura|floor|apt\.?|apartment|street|st\.?|avenue|ave\.?|boulevard|blvd\.?|suite|ste\.?|unit|building|bldg\.?)/i;

    // ============ EXTRACTION ============

    // 1. Extract emails
    let match;
    while ((match = emailRegex.exec(text)) !== null) {
        if (!isRangeUsed(match.index, match.index + match[0].length)) {
            pills.push({
                type: 'email',
                value: match[0],
                display: match[0]
            });
            markUsed(match.index, match.index + match[0].length);
        }
    }

    // 2. Extract URLs
    while ((match = urlRegex.exec(text)) !== null) {
        if (!isRangeUsed(match.index, match.index + match[0].length)) {
            const url = match[0].startsWith('www.') ? `https://${match[0]}` : match[0];
            const displayUrl = match[0].replace(/^https?:\/\//, '').slice(0, 30);
            pills.push({
                type: 'url',
                value: url,
                display: displayUrl + (match[0].length > 35 ? '...' : '')
            });
            markUsed(match.index, match.index + match[0].length);
        }
    }

    // 3. Extract social handles
    while ((match = socialRegex.exec(text)) !== null) {
        if (!isRangeUsed(match.index, match.index + match[0].length)) {
            const cleaned = match[0].trim();
            pills.push({
                type: 'social',
                value: cleaned,
                display: cleaned
            });
            markUsed(match.index, match.index + match[0].length);
        }
    }

    // 4. Extract documents
    while ((match = docRegex.exec(text)) !== null) {
        if (!isRangeUsed(match.index, match.index + match[0].length)) {
            const cleaned = match[0].trim();
            pills.push({
                type: 'document',
                value: cleaned.replace(/[^\d]/g, ''), // Just digits for lookup
                display: cleaned.toUpperCase()
            });
            markUsed(match.index, match.index + match[0].length);
        }
    }

    // 5. Extract phones (be careful not to match document numbers)
    while ((match = phoneRegex.exec(text)) !== null) {
        if (!isRangeUsed(match.index, match.index + match[0].length)) {
            const cleanPhone = match[0].trim();
            const digitCount = (cleanPhone.match(/\d/g) || []).length;
            // Phone should have 7-15 digits (not too short, not doc-like)
            if (digitCount >= 7 && digitCount <= 15) {
                pills.push({
                    type: 'phone',
                    value: cleanPhone.replace(/[^\d+]/g, ''),
                    display: cleanPhone
                });
                markUsed(match.index, match.index + match[0].length);
            }
        }
    }

    // 6. Process remaining lines for addresses and other
    // First, collect all extracted display values for deduplication
    const extractedValues = new Set(pills.map(p => p.display.toLowerCase()));
    const extractedDigits = new Set(pills.filter(p => p.type === 'document' || p.type === 'phone')
        .map(p => p.value.replace(/\D/g, '')));

    const lines = text.split('\n');

    for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;

        // Skip if this exact line was already extracted
        if (extractedValues.has(trimmedLine.toLowerCase())) continue;

        // Skip if the line is just a document/phone number we already have
        const lineDigits = trimmedLine.replace(/\D/g, '');
        if (lineDigits.length >= 6 && extractedDigits.has(lineDigits)) continue;

        // Skip if line contains a document keyword and digits we already extracted
        if (/dni|cuil|cuit|ci|rut|cedula|documento/i.test(trimmedLine)) {
            const hasExtractedDigits = Array.from(extractedDigits).some(d => trimmedLine.includes(d));
            if (hasExtractedDigits) continue;
        }

        // Check for address keywords
        if (addressKeywords.test(trimmedLine)) {
            pills.push({
                type: 'address',
                value: trimmedLine,
                display: trimmedLine.length > 50 ? trimmedLine.slice(0, 47) + '...' : trimmedLine
            });
            extractedValues.add(trimmedLine.toLowerCase());
        } else if (trimmedLine.length > 3) {
            // Only add as "other" if it has meaningful content
            // Skip if it's mostly punctuation/separators or just numbers
            const meaningfulChars = trimmedLine.replace(/[\s\-.,;:\d]/g, '');
            if (meaningfulChars.length > 2) {
                pills.push({
                    type: 'other',
                    value: trimmedLine,
                    display: trimmedLine.length > 50 ? trimmedLine.slice(0, 47) + '...' : trimmedLine
                });
                extractedValues.add(trimmedLine.toLowerCase());
            }
        }
    }

    return pills;
}

const pillIcons: Record<ContactPill['type'], string> = {
    phone: '📞',
    email: '✉️',
    url: '🔗',
    document: '🪪',
    address: '📍',
    social: '💬',
    other: '📝'
};

const pillColors: Record<ContactPill['type'], string> = {
    phone: 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100',
    email: 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100',
    url: 'bg-teal-50 text-teal-700 border-teal-200 hover:bg-teal-100',
    document: 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100',
    address: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100',
    social: 'bg-pink-50 text-pink-700 border-pink-200 hover:bg-pink-100',
    other: 'bg-stone-50 text-stone-700 border-stone-200 hover:bg-stone-100'
};

export function ContactPills({ text, showIcons = true }: ContactPillsProps) {
    const { t } = useLanguage();
    const pills = parseContactInfo(text);

    if (pills.length === 0) {
        return (
            <span className="text-stone-500 italic">
                {t('common.no_contact')}
            </span>
        );
    }

    const handleClick = (pill: ContactPill) => {
        switch (pill.type) {
            case 'phone':
                window.location.href = `tel:${pill.value}`;
                break;
            case 'email':
                window.location.href = `mailto:${pill.value}`;
                break;
            case 'url':
                window.open(pill.value, '_blank', 'noopener,noreferrer');
                break;
            case 'address':
                window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(pill.value)}`, '_blank');
                break;
            case 'social':
                // Try to detect platform and open appropriate URL
                const lowerValue = pill.value.toLowerCase();
                if (lowerValue.includes('instagram') || lowerValue.includes('ig')) {
                    const handle = pill.value.replace(/.*@/, '').trim();
                    window.open(`https://instagram.com/${handle}`, '_blank');
                } else if (lowerValue.includes('facebook') || lowerValue.includes('fb')) {
                    const handle = pill.value.replace(/.*@/, '').trim();
                    window.open(`https://facebook.com/${handle}`, '_blank');
                } else if (lowerValue.includes('twitter')) {
                    const handle = pill.value.replace(/.*@/, '').trim();
                    window.open(`https://twitter.com/${handle}`, '_blank');
                } else if (pill.value.startsWith('@')) {
                    // Generic @ handle - copy to clipboard
                    navigator.clipboard.writeText(pill.value);
                }
                break;
            default:
                // Copy to clipboard for document/other types
                navigator.clipboard.writeText(pill.value);
                break;
        }
    };

    return (
        <div className="flex flex-wrap gap-2">
            {pills.map((pill, index) => (
                <button
                    key={`${pill.type}-${index}`}
                    onClick={() => handleClick(pill)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition-all cursor-pointer ${pillColors[pill.type]}`}
                    title={pill.type === 'other' || pill.type === 'document' ? 'Click to copy' : `Open ${pill.type}`}
                >
                    {showIcons && <span>{pillIcons[pill.type]}</span>}
                    <span className="max-w-[200px] truncate">{pill.display}</span>
                </button>
            ))}
        </div>
    );
}

export { parseContactInfo, type ContactPill };
