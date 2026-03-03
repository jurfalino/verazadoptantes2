'use client';

/**
 * DatePicker — Uses native <input type="date"> for full dates,
 * with an optional "approximate" toggle that shows Month + Year only.
 *
 * value / onChange use ISO date strings:
 *   - Full:     'YYYY-MM-DD'
 *   - Approx:   'YYYY-MM'
 */

import { useState } from 'react';

const MONTHS = [
    { value: 1, label: 'Ene' },
    { value: 2, label: 'Feb' },
    { value: 3, label: 'Mar' },
    { value: 4, label: 'Abr' },
    { value: 5, label: 'May' },
    { value: 6, label: 'Jun' },
    { value: 7, label: 'Jul' },
    { value: 8, label: 'Ago' },
    { value: 9, label: 'Sep' },
    { value: 10, label: 'Oct' },
    { value: 11, label: 'Nov' },
    { value: 12, label: 'Dic' },
];

function pad(n: number): string {
    return n.toString().padStart(2, '0');
}

interface DatePickerProps {
    value: string;              // 'YYYY-MM-DD' or 'YYYY-MM' or ''
    onChange: (iso: string) => void;
    maxDate?: string;           // optional max date 'YYYY-MM-DD'
    dayOptional?: boolean;      // show the "approximate date" toggle
    className?: string;
}

export default function DatePicker({ value, onChange, maxDate, dayOptional = false, className = '' }: DatePickerProps) {
    // Detect if current value is approximate (no day component)
    const parts = value ? value.split('-') : [];
    const isCurrentlyApprox = parts.length === 2;
    const [approximate, setApproximate] = useState(isCurrentlyApprox);

    // Parse max date
    const maxParts = maxDate ? maxDate.split('-').map(Number) : null;
    const maxYear = maxParts ? maxParts[0] : new Date().getFullYear();
    const maxMonth = maxParts ? maxParts[1] : 12;

    // Parse current value for approximate mode
    const currentYear = parts[0] ? Number(parts[0]) : new Date().getFullYear();
    const currentMonth = parts[1] ? Number(parts[1]) : (new Date().getMonth() + 1);

    // Build year range: maxYear down to 6 years ago
    const years = Array.from({ length: 7 }, (_, i) => maxYear - i);

    // Build month options — filter months that are in the future for the selected year
    const availableMonths = MONTHS.filter(m => {
        if (currentYear < maxYear) return true;           // past years: all months valid
        return m.value <= maxMonth;                        // current year: only up to max month
    });

    const handleToggleApprox = () => {
        const next = !approximate;
        setApproximate(next);
        if (next) {
            // Switch to approximate: strip day → 'YYYY-MM'
            const y = parts[0] || String(new Date().getFullYear());
            const m = parts[1] || pad(new Date().getMonth() + 1);
            onChange(`${y}-${m}`);
        } else {
            // Switch to full: add day 1 → 'YYYY-MM-DD'
            const y = parts[0] || String(new Date().getFullYear());
            const m = parts[1] || pad(new Date().getMonth() + 1);
            onChange(`${y}-${m}-01`);
        }
    };

    const handleYearChange = (y: number) => {
        // If switching to a year where current month is invalid, clamp to max available month
        let m = currentMonth;
        if (y === maxYear && m > maxMonth) m = maxMonth;
        onChange(`${y}-${pad(m)}`);
    };

    const handleMonthChange = (m: number) => {
        onChange(`${currentYear}-${pad(m)}`);
    };

    const inputClass = 'h-10 rounded-lg border border-stone-300 bg-white text-stone-900 font-medium focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 transition-all outline-none text-sm';
    const selectClass = `${inputClass} appearance-none px-3 text-center`;

    return (
        <div className={`space-y-2 ${className}`}>
            <div className="flex items-center gap-2">
                {approximate ? (
                    /* Approximate mode: Month + Year dropdowns */
                    <>
                        <select
                            className={`${selectClass} w-20`}
                            value={currentMonth}
                            onChange={e => handleMonthChange(Number(e.target.value))}
                        >
                            {availableMonths.map(m => (
                                <option key={m.value} value={m.value}>{m.label}</option>
                            ))}
                        </select>
                        <select
                            className={`${selectClass} w-20`}
                            value={currentYear}
                            onChange={e => handleYearChange(Number(e.target.value))}
                        >
                            {years.map(y => (
                                <option key={y} value={y}>{y}</option>
                            ))}
                        </select>
                    </>
                ) : (
                    /* Full mode: Native date input */
                    <input
                        type="date"
                        className={`${inputClass} px-3 w-[160px]`}
                        value={value}
                        max={maxDate}
                        onChange={e => onChange(e.target.value)}
                    />
                )}
            </div>

            {/* Approximate toggle */}
            {dayOptional && (
                <label className="flex items-center gap-2 cursor-pointer select-none group">
                    <button
                        type="button"
                        onClick={handleToggleApprox}
                        className={`relative w-8 h-[18px] rounded-full transition-colors ${approximate ? 'bg-teal-500' : 'bg-stone-200 group-hover:bg-stone-300'}`}
                    >
                        <span className={`absolute top-[2px] left-[2px] w-[14px] h-[14px] bg-white rounded-full shadow transition-transform ${approximate ? 'translate-x-[14px]' : 'translate-x-0'}`} />
                    </button>
                    <span className="text-xs text-stone-500">
                        {approximate ? 'Fecha aproximada (solo mes y año)' : 'No sé el día exacto'}
                    </span>
                </label>
            )}
        </div>
    );
}
