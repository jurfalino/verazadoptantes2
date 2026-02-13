'use client';

/**
 * DatePicker — day / month (3-letter) / year dropdowns.
 * Avoids DD/MM vs MM/DD ambiguity by showing "Jan", "Feb", etc.
 *
 * value / onChange use ISO date strings (YYYY-MM-DD) so they
 * integrate seamlessly with existing formData.
 */

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

function daysInMonth(month: number, year: number): number {
    return new Date(year, month, 0).getDate();
}

function pad(n: number): string {
    return n.toString().padStart(2, '0');
}

interface DatePickerProps {
    value: string;              // ISO string YYYY-MM-DD (or empty)
    onChange: (iso: string) => void;
    maxDate?: string;           // optional max date ISO string
    className?: string;
}

export default function DatePicker({ value, onChange, maxDate, className = '' }: DatePickerProps) {
    // Parse current value
    const parts = value ? value.split('-').map(Number) : [];
    const year = parts[0] || new Date().getFullYear();
    const month = parts[1] || (new Date().getMonth() + 1);
    const day = parts[2] || new Date().getDate();

    // Build year range: current year down to 5 years ago
    const currentYear = new Date().getFullYear();
    const years = Array.from({ length: 6 }, (_, i) => currentYear - i);

    // Build day options based on selected month/year
    const maxDay = daysInMonth(month, year);
    const clampedDay = Math.min(day, maxDay);

    // Max date constraints
    const maxParts = maxDate ? maxDate.split('-').map(Number) : null;

    const emit = (y: number, m: number, d: number) => {
        const clamped = Math.min(d, daysInMonth(m, y));
        onChange(`${y}-${pad(m)}-${pad(clamped)}`);
    };

    const selectClass = 'h-10 rounded-lg border border-stone-300 bg-white text-stone-900 font-medium focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 transition-all outline-none text-sm appearance-none px-2 text-center';

    return (
        <div className={`flex items-center gap-1.5 ${className}`}>
            {/* Day */}
            <select
                className={`${selectClass} w-16`}
                value={clampedDay}
                onChange={e => emit(year, month, Number(e.target.value))}
            >
                {Array.from({ length: maxDay }, (_, i) => i + 1).map(d => {
                    // Disable days past maxDate in the same month/year
                    const disabled = maxParts && year === maxParts[0] && month === maxParts[1] && d > maxParts[2];
                    return <option key={d} value={d} disabled={!!disabled}>{d}</option>;
                })}
            </select>

            {/* Month */}
            <select
                className={`${selectClass} w-20`}
                value={month}
                onChange={e => emit(year, Number(e.target.value), clampedDay)}
            >
                {MONTHS.map(m => {
                    const disabled = maxParts && year === maxParts[0] && m.value > maxParts[1];
                    return <option key={m.value} value={m.value} disabled={!!disabled}>{m.label}</option>;
                })}
            </select>

            {/* Year */}
            <select
                className={`${selectClass} w-20`}
                value={year}
                onChange={e => emit(Number(e.target.value), month, clampedDay)}
            >
                {years.map(y => {
                    const disabled = maxParts && y > maxParts[0];
                    return <option key={y} value={y} disabled={!!disabled}>{y}</option>;
                })}
            </select>
        </div>
    );
}
