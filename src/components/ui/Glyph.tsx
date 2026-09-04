'use client';

/**
 * The functional icons the import wizard was drawing with emoji.
 *
 * §1.3 permits emoji ONLY as decorative subject markers beside a text label —
 * the species picker (🐕/🐱/🐦) and the record-type chips (🏠/📝/📞) are fine and
 * are left alone. Everything here is a functional icon: a status signal, a
 * close control, a selection state, an affordance. §5 row 8 removed those
 * project-wide in v36 because emoji render differently per OS and browser, do
 * not inherit `currentColor`, and so cannot follow the theme.
 *
 * Every glyph is stroke-based on `currentColor`, so colour comes from the
 * parent and both themes work without a second definition.
 */

interface GlyphProps {
    className?: string;
    /** Decorative by default; pass a label when the icon is the only content. */
    label?: string;
}

function svg(path: React.ReactNode, { className = 'w-4 h-4', label }: GlyphProps, extra?: Record<string, unknown>) {
    return (
        <svg
            className={className}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            role={label ? 'img' : undefined}
            aria-label={label}
            aria-hidden={label ? undefined : true}
            {...extra}
        >
            {path}
        </svg>
    );
}

/** Status: warning. Replaces ⚠️. */
export const WarningIcon = (p: GlyphProps = {}) =>
    svg(<><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></>, p);

/** Control: dismiss. Replaces ✕. */
export const CloseIcon = (p: GlyphProps = {}) =>
    svg(<path d="M18 6 6 18M6 6l12 12" />, p);

/** State: selected. Replaces ✓. */
export const CheckIcon = (p: GlyphProps = {}) =>
    svg(<path d="M20 6 9 17l-5-5" />, p);

/** Affordance: attach a file. Replaces 📎. */
export const AttachIcon = (p: GlyphProps = {}) =>
    svg(<path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.9-2.9l8.5-8.5" />, p);

/** Affordance: upload. Replaces 📤. */
export const UploadIcon = (p: GlyphProps = {}) =>
    svg(<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M17 8l-5-5-5 5M12 3v12" /></>, p);

/** Affordance: video. Replaces 📹 and 🎬. */
export const VideoIcon = (p: GlyphProps = {}) =>
    svg(<><rect x="2" y="6" width="14" height="12" rx="2" /><path d="m22 8-6 4 6 4V8Z" /></>, p);

/** Affordance: AI extraction. Replaces 🤖. */
export const SparkIcon = (p: GlyphProps = {}) =>
    svg(<><path d="M12 3v4M12 17v4M3 12h4M17 12h4" /><path d="M7.8 7.8 5 5M16.2 7.8 19 5M7.8 16.2 5 19M16.2 16.2 19 19" /><circle cx="12" cy="12" r="3" /></>, p);

/** Affordance: save. Replaces 💾. */
export const SaveIcon = (p: GlyphProps = {}) =>
    svg(<><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" /><path d="M17 21v-8H7v8M7 3v5h8" /></>, p);
