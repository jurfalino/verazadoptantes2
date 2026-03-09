/**
 * Parse text containing URLs, emails, and phone numbers into clickable links.
 * Extracted from AdopterForm to be reusable across components.
 */

import React from 'react';

interface TextWithLinksOptions {
    emptyLabel?: string;
    type?: 'text' | 'address';
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

    return text.split('\n').map((line, i) =>
        React.createElement('div', { key: i, className: 'min-h-[1.5em] mb-1 last:mb-0' },
            ...line.split(' ').map((word, j) => {
                // URL
                if (word.match(/^(http|https):\/\//) || word.match(/^www\./)) {
                    const href = word.startsWith('www') ? `https://${word}` : word;
                    return React.createElement('a', { key: j, href, target: '_blank', rel: 'noopener noreferrer', className: 'text-teal-700 hover:text-teal-800 hover:underline mr-1 font-medium' }, word);
                }
                // Email
                if (word.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
                    return React.createElement('a', { key: j, href: `mailto:${word}`, className: 'text-teal-700 hover:text-teal-800 hover:underline mr-1 font-medium' }, word);
                }
                // Phone
                if (word.match(/^(\+?\d{1,3}[-.])?\(?\d{3}\)?[-.]\d{3}[-.]\d{4}$/)) {
                    return React.createElement('a', { key: j, href: `tel:${word}`, className: 'text-teal-700 hover:text-teal-800 hover:underline mr-1 font-medium bg-teal-50 px-1 rounded' }, word);
                }
                return React.createElement('span', { key: j, className: 'mr-1' }, word);
            })
        )
    );
}
