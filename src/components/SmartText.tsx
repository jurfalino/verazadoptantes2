import React from 'react';

interface SmartTextProps {
    text: string | null | undefined;
    type?: 'contact' | 'address';
    className?: string;
}

export function SmartText({ text, type = 'contact', className = '' }: SmartTextProps) {
    if (!text) return null;

    // Render Address Mode (Link whole lines to Maps)
    if (type === 'address') {
        return (
            <div className={`space-y-1 ${className}`}>
                {text.split('\n').map((line, i) => {
                    const trimmed = line.trim();
                    if (!trimmed) return <br key={i} />;
                    const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(trimmed)}`;
                    return (
                        <div key={i}>
                            <a
                                href={mapUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:underline flex items-center gap-2"
                            >
                                {trimmed}
                            </a>
                        </div>
                    );
                })}
            </div>
        );
    }

    // Render Contact Mode (Parse Phones, URLs, Emails)
    return (
        <div className={`whitespace-pre-wrap ${className}`}>
            {text.split('\n').map((line, i) => (
                <div key={i}>
                    {parseLine(line)}
                </div>
            ))}
        </div>
    );
}

function parseLine(line: string) {
    if (!line.trim()) return <br />;

    // Regex patterns
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/g;
    // Simple phone regex: (123) 456-7890 or 123-456-7890 or +1...
    // Should have at least 7 digits and some format chars
    const phoneRegex = /(\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/g;

    // Split by URL first
    const parts = line.split(urlRegex);

    return parts.map((part, index) => {
        if (part.match(urlRegex)) {
            return <a key={index} href={part} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{part}</a>;
        }

        // Then split by Email
        const emailParts = part.split(emailRegex);
        return emailParts.map((subPart, subIndex) => {
            if (subPart.match(emailRegex)) {
                return <a key={`${index}-${subIndex}`} href={`mailto:${subPart}`} className="text-blue-600 hover:underline">{subPart}</a>;
            }

            // Then split by Phone
            const phoneParts = subPart.split(phoneRegex);
            return phoneParts.map((lastPart, lastIndex) => {
                if (lastPart.match(phoneRegex)) {
                    // Clean non-digits for tel link
                    const cleanPhone = lastPart.replace(/\D/g, '');
                    return <a key={`${index}-${subIndex}-${lastIndex}`} href={`tel:${cleanPhone}`} className="text-blue-600 hover:underline">{lastPart}</a>;
                }
                return lastPart;
            });
        });
    });
}
