/**
 * Inline SVGs for the 404 page and the "belongs to another rescuer" screen.
 * Colours are --illo-* tokens (globals.css, both themes). Decorative only.
 */
import type { AnimalIllustration } from '@/domain/animalAccess';

const base = {
    fill: 'none',
    stroke: 'var(--illo-line)',
    strokeWidth: 2.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
};

export function DogAtePage() {
    return (
        <svg viewBox="0 0 180 140" className="w-44 h-auto" {...base}>
            <ellipse cx="90" cy="132" rx="60" ry="5" fill="var(--illo-ground)" stroke="none" />
            <path d="M52 40 C38 44 32 70 42 84 C50 76 56 62 58 50Z" fill="var(--illo-ear)" />
            <path d="M128 40 C142 44 148 70 138 84 C130 76 124 62 122 50Z" fill="var(--illo-ear)" />
            <path d="M56 46 C60 22 120 22 124 46 C130 74 120 104 90 106 C60 104 50 74 56 46Z" fill="var(--illo-fur-dog)" />
            <circle cx="76" cy="58" r="4" fill="var(--illo-line)" stroke="none" />
            <circle cx="102" cy="58" r="4" fill="var(--illo-line)" stroke="none" />
            <path d="M70 50 Q76 47 82 51" /><path d="M96 51 Q102 47 108 50" />
            <path d="M84 72 Q90 68 96 72 Q90 78 84 72Z" fill="var(--illo-line)" />
            <path d="M58 84 L122 80 L126 100 L118 96 L112 104 L104 97 L96 106 L88 98 L80 106 L72 98 L64 104 L60 96Z" fill="var(--illo-paper)" stroke="var(--illo-mark)" />
            <text x="92" y="95" textAnchor="middle" fontSize="13" fontWeight="800" fill="var(--illo-mark)" stroke="none">404</text>
            <path d="M40 116 l6 -3 l2 5z" fill="var(--illo-paper)" stroke="var(--illo-mark)" strokeWidth="1.5" />
            <path d="M132 118 l7 1 l-3 5z" fill="var(--illo-paper)" stroke="var(--illo-mark)" strokeWidth="1.5" />
            <path d="M146 104 l5 -4 l2 6z" fill="var(--illo-paper)" stroke="var(--illo-mark)" strokeWidth="1.5" />
        </svg>
    );
}

export function CatKnockedPage() {
    return (
        <svg viewBox="0 0 180 140" className="w-44 h-auto" {...base}>
            <path d="M10 76 H112" stroke="var(--illo-bare)" strokeWidth="3" />
            <path d="M24 76 V132" stroke="var(--illo-bare)" /><path d="M98 76 V132" stroke="var(--illo-bare)" />
            <path d="M40 76 C34 56 40 40 56 38 C72 40 78 56 72 76Z" fill="var(--illo-fur-cat)" />
            <path d="M40 72 C26 70 22 56 30 50" stroke="var(--illo-bare)" />
            <path d="M44 34 L46 16 L56 26 L66 16 L68 34 C70 46 42 46 44 34Z" fill="var(--illo-fur-cat)" />
            <path d="M50 30 h5" /><path d="M59 30 h5" />
            <path d="M54 37 q2 2 4 0" />
            <path d="M70 60 C80 58 88 62 94 64" stroke="var(--illo-bare)" />
            <circle cx="96" cy="64" r="4" fill="var(--illo-fur-cat)" />
            <g transform="rotate(28 136 100)">
                <rect x="118" y="80" width="36" height="44" rx="4" fill="var(--illo-paper)" stroke="var(--illo-mark)" />
                <text x="136" y="107" textAnchor="middle" fontSize="12" fontWeight="800" fill="var(--illo-mark)" stroke="none">404</text>
            </g>
            <path d="M114 70 q6 4 8 10" stroke="var(--illo-motion)" strokeWidth="2" />
            <path d="M124 64 q8 4 10 12" stroke="var(--illo-motion)" strokeWidth="2" />
        </svg>
    );
}

function HeartTag({ cx, cy }: { cx: number; cy: number }) {
    return (
        <>
            <circle cx={cx} cy={cy} r="8" fill="var(--illo-paper)" stroke="var(--illo-mark)" />
            <path
                d={`M${cx - 3.5} ${cy - 1} a2 2 0 0 1 3.5 -1.5 a2 2 0 0 1 3.5 1.5 q0 2.5 -3.5 5 q-3.5 -2.5 -3.5 -5z`}
                fill="var(--illo-mark)" stroke="none"
            />
        </>
    );
}

export function TaggedPet({ kind, label }: { kind: AnimalIllustration; label: string }) {
    return (
        <svg viewBox="0 0 150 110" className="w-36 h-auto" data-testid="owned-illustration" data-kind={kind} {...base}>
            <ellipse cx="75" cy="104" rx="46" ry="4" fill="var(--illo-ground)" stroke="none" />
            {kind === 'cat' && (
                <>
                    <path d="M48 98 C40 70 48 52 75 50 C102 52 110 70 102 98Z" fill="var(--illo-fur-cat)" />
                    <path d="M52 50 L54 22 L68 36 L82 36 L96 22 L98 50 C100 66 50 66 52 50Z" fill="var(--illo-fur-cat)" />
                    <circle cx="66" cy="46" r="3" fill="var(--illo-line)" stroke="none" />
                    <circle cx="84" cy="46" r="3" fill="var(--illo-line)" stroke="none" />
                    <path d="M72 53 q3 3 6 0" />
                    <path d="M56 62 Q75 70 94 62" stroke="var(--illo-mark)" strokeWidth="4" />
                    <HeartTag cx={75} cy={74} />
                    <path d="M102 96 C120 96 124 80 116 72" stroke="var(--illo-bare)" />
                </>
            )}
            {kind === 'dog' && (
                <>
                    <path d="M46 100 C40 76 50 60 75 58 C100 60 110 76 104 100Z" fill="var(--illo-fur-dog)" />
                    <path d="M50 20 C38 22 34 44 42 54 C48 48 52 38 54 28Z" fill="var(--illo-ear)" />
                    <path d="M100 20 C112 22 116 44 108 54 C102 48 98 38 96 28Z" fill="var(--illo-ear)" />
                    <path d="M52 26 C56 8 94 8 98 26 C102 44 94 60 75 60 C56 60 48 44 52 26Z" fill="var(--illo-fur-dog)" />
                    <circle cx="65" cy="32" r="3" fill="var(--illo-line)" stroke="none" />
                    <circle cx="85" cy="32" r="3" fill="var(--illo-line)" stroke="none" />
                    <path d="M70 42 Q75 39 80 42 Q75 47 70 42Z" fill="var(--illo-line)" />
                    <path d="M75 47 v3 M70 52 q5 3 10 0" />
                    <path d="M56 64 Q75 72 94 64" stroke="var(--illo-mark)" strokeWidth="4" />
                    <HeartTag cx={75} cy={77} />
                    <path d="M104 92 q14 -4 12 -20" stroke="var(--illo-bare)" />
                </>
            )}
            {kind === 'bird' && (
                <>
                    <path d="M30 90 H120" stroke="var(--illo-motion)" strokeWidth="4" />
                    <path d="M70 76 L60 100 L78 84Z" fill="var(--illo-feather-dark)" />
                    <path d="M58 64 C54 40 66 22 82 24 C98 26 102 46 96 64 C92 80 64 84 58 64Z" fill="var(--illo-feather)" />
                    <path d="M66 50 C64 64 72 74 86 74 C82 62 78 54 66 50Z" fill="var(--illo-feather-dark)" />
                    <circle cx="86" cy="36" r="3" fill="var(--illo-line)" stroke="none" />
                    <path d="M96 38 L108 42 L96 46Z" fill="var(--illo-beak)" />
                    <path d="M72 80 V90 M84 80 V90" stroke="var(--illo-bare)" />
                    <rect x="80" y="82" width="8" height="5" rx="1.5" fill="var(--illo-paper)" stroke="var(--illo-mark)" strokeWidth="2" />
                </>
            )}
            {kind === 'tag' && (
                <>
                    <circle cx="75" cy="14" r="8" stroke="var(--illo-motion)" strokeWidth="3" />
                    <circle cx="75" cy="58" r="36" fill="var(--illo-paper)" stroke="var(--illo-mark)" strokeWidth="3" />
                    <circle cx="75" cy="58" r="29" stroke="var(--illo-feather)" strokeWidth="2" />
                    <path d="M69 40 a4 4 0 0 1 6 -3 a4 4 0 0 1 6 3 q0 4 -6 8 q-6 -4 -6 -8z" fill="var(--illo-mark)" stroke="none" />
                    <text x="75" y="70" textAnchor="middle" fontSize="14" fontWeight="800" fill="var(--illo-line)" stroke="none" {...(label.length > 6 ? { textLength: 56, lengthAdjust: 'spacingAndGlyphs' } : {})}>{label}</text>
                </>
            )}
        </svg>
    );
}
