'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * The button matrix from `docs/design-style-guide.md` §2.1, as code.
 *
 * It existed only as a table, so nothing enforced it: an audit of ImportWizard
 * found EIGHT distinct padding pairs across ~22 buttons and neither of the two
 * the matrix defines. Weights were 500 where the matrix says 700, and radii
 * mixed `rounded-xl`, `rounded-lg` and `rounded-full`. That is what a spec with
 * no implementation costs — every change reasonably invents its own spacing.
 *
 * Only themed utilities are used. `globals.css` remaps the stone/teal palette
 * under `[data-theme]`; a raw `bg-blue-*` renders unmapped and breaks Azul
 * Noche, which is anti-pattern §5 row 6.
 */

type Variant = 'primary' | 'secondary' | 'success' | 'destructive';
type Size = 'standard' | 'compact';

/** Matrix §2.1: every button, both sizes. */
const BASE =
    'inline-flex items-center justify-center gap-2 rounded-xl font-bold ' +
    'transition-all duration-200 focus:outline-none focus-visible:ring-2 ' +
    'focus-visible:ring-teal-500 focus-visible:ring-offset-1 ' +
    'disabled:opacity-40 disabled:cursor-not-allowed';

/**
 * Standard is `12px 24px`, Compact `8px 16px`. Both clear the 44px minimum tap
 * target (§1.5) once line-height is counted, which is why the matrix has no
 * third, smaller size — anything smaller fails the accessibility floor.
 */
const SIZES: Record<Size, string> = {
    standard: 'py-3 px-6 text-sm min-h-[44px]',
    compact: 'py-2 px-4 text-[13px] min-h-[44px]',
};

const VARIANTS: Record<Variant, string> = {
    primary: 'bg-teal-600 text-white shadow-sm hover:bg-teal-700 hover:shadow-md active:shadow-sm',
    secondary: 'bg-teal-50 text-teal-700 border border-teal-200 hover:bg-teal-100 hover:border-teal-400',
    success: 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100',
    destructive: 'bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100',
};

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
    variant?: Variant;
    size?: Size;
    /** Swaps the label for a spinner and disables the button (matrix "Loading"). */
    loading?: boolean;
    /** Leading icon. Pass an SVG — never an emoji (§1.3, §5 row 8). */
    icon?: ReactNode;
    fullWidth?: boolean;
    children?: ReactNode;
    /** Escape hatch for layout only (width, margin). Never for colour or padding. */
    layoutClassName?: string;
}

export function Button({
    variant = 'primary',
    size = 'standard',
    loading = false,
    icon,
    fullWidth = false,
    children,
    layoutClassName = '',
    disabled,
    ...rest
}: ButtonProps) {
    return (
        <button
            {...rest}
            disabled={disabled || loading}
            aria-busy={loading || undefined}
            className={`${BASE} ${SIZES[size]} ${VARIANTS[variant]} ${fullWidth ? 'w-full' : ''} ${layoutClassName}`}
        >
            {loading ? (
                <svg className="w-4 h-4 animate-spin motion-reduce:hidden" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.3" />
                    <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
            ) : icon}
            {children}
        </button>
    );
}
