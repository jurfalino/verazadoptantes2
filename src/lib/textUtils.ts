/**
 * Parse text containing URLs, emails, phone numbers and social handles into clickable links.
 * Extracted from AdopterForm to be reusable across components.
 */

import React from 'react';

interface TextWithLinksOptions {
    emptyLabel?: string;
    type?: 'text' | 'address';
}

// Phone pattern: matches sequences of 7+ digits with optional separators (-, ., spaces, parens)
// Handles: +54 11-5555-0001, (011) 5555-0001, 11-5555-0001, 1155550001
const PHONE_RE = /(\+?\d[\d\s\-().]{6,}\d)/;

// Email pattern
const EMAIL_RE = /([^\s,;:]+@[^\s,;:]+\.[^\s,;:]+)/;

// URL pattern
const URL_RE = /(https?:\/\/[^\s,;]+|www\.[^\s,;]+)/;



/** Strip non-digit chars to build a clean tel: href */
function cleanPhone(raw: string): string {
    return raw.replace(/[^\d+]/g, '');
}

export function renderTextWithLinks(
    text: string,
    { emptyLabel = '—', type = 'text' }: TextWithLinksOptions = {}
): React.ReactNode {
    if (!text) {
        return React.createElement('span', { className: 'text-stone-500 italic' }, emptyLabel);
    }

    if (type === 'address') {
        const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text.replace(/\n/g, ', '))}`;
        return React.createElement('a', {
            href: mapUrl,
            target: '_blank',
            rel: 'noopener noreferrer',
            className: 'flex items-start gap-2 text-teal-700 hover:text-teal-900 group transition-colors',
        },
            React.createElement('svg', {
                className: 'w-5 h-5 shrink-0 mt-0.5 text-teal-700 group-hover:scale-110 transition-transform',
                fill: 'none',
                stroke: 'currentColor',
                viewBox: '0 0 24 24',
            },
                React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z' }),
                React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M15 11a3 3 0 11-6 0 3 3 0 016 0z' })
            ),
            React.createElement('span', {
                className: 'whitespace-pre-line group-hover:underline decoration-teal-500/50 underline-offset-4',
            }, text)
        );
    }

    // Tokenize: split text into typed segments (plain, url, email, phone, ig)
    type Token = { type: 'plain' | 'url' | 'email' | 'phone' | 'ig'; value: string };

    function tokenizeLine(line: string): Token[] {
        const tokens: Token[] = [];
        // Build a combined regex from sources — each source has exactly 1 capturing group
        // Group 1 = URL, Group 2 = Email, Group 3 = Phone, Group 4 = IG
        const combined = new RegExp(
            `${URL_RE.source}|${EMAIL_RE.source}|${PHONE_RE.source}|(?:^|[\\s,;:])(@[a-zA-Z0-9._]{3,30})(?=[\\s,;:]|$)`,
            'g'
        );

        let lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = combined.exec(line)) !== null) {
            // Add plain text before this match
            if (match.index > lastIndex) {
                const plain = line.slice(lastIndex, match.index);
                if (plain) tokens.push({ type: 'plain', value: plain });
            }

            if (match[1]) {
                // URL match
                tokens.push({ type: 'url', value: match[1] });
            } else if (match[2]) {
                // Email match
                tokens.push({ type: 'email', value: match[2] });
            } else if (match[3]) {
                // Phone — only accept if it has 7+ actual digits
                const digits = match[3].replace(/\D/g, '');
                if (digits.length >= 7) {
                    tokens.push({ type: 'phone', value: match[3].trim() });
                } else {
                    tokens.push({ type: 'plain', value: match[3] });
                }
            } else if (match[4]) {
                // Instagram handle — capture any leading whitespace as plain text
                const fullMatch = match[0];
                const prefix = fullMatch.slice(0, fullMatch.indexOf('@'));
                if (prefix) tokens.push({ type: 'plain', value: prefix });
                tokens.push({ type: 'ig', value: match[4] });
            } else {
                tokens.push({ type: 'plain', value: match[0] });
            }
            lastIndex = match.index + match[0].length;
        }
        // Remaining plain text
        if (lastIndex < line.length) {
            tokens.push({ type: 'plain', value: line.slice(lastIndex) });
        }
        return tokens.length > 0 ? tokens : [{ type: 'plain', value: line }];
    }

    return text.split('\n').map((line, i) => {
        const tokens = tokenizeLine(line);
        return React.createElement('div', { key: i, className: 'min-h-[1.5em] mb-1 last:mb-0' },
            ...tokens.map((tok, j) => {
                switch (tok.type) {
                    case 'url': {
                        const href = tok.value.startsWith('www') ? `https://${tok.value}` : tok.value;
                        return React.createElement('a', { key: j, href, target: '_blank', rel: 'noopener noreferrer', className: 'text-teal-700 hover:text-teal-800 hover:underline font-medium' }, tok.value);
                    }
                    case 'email':
                        return React.createElement('a', { key: j, href: `mailto:${tok.value}`, className: 'text-teal-700 hover:text-teal-800 hover:underline font-medium' }, tok.value);
                    case 'phone':
                        return React.createElement('a', { key: j, href: `tel:${cleanPhone(tok.value)}`, className: 'text-teal-700 hover:text-teal-800 hover:underline font-medium inline-flex items-center gap-0.5' },
                            React.createElement('span', { className: 'text-xs' }, '📞'),
                            tok.value
                        );
                    case 'ig':
                        return React.createElement('a', { key: j, href: `https://instagram.com/${tok.value.replace('@', '')}`, target: '_blank', rel: 'noopener noreferrer', className: 'text-teal-700 hover:text-teal-800 hover:underline font-medium' }, tok.value);
                    default:
                        return React.createElement('span', { key: j }, tok.value);
                }
            })
        );
    });
}
