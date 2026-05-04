'use client';

import { ReactNode } from "react";

interface CollapsibleSectionProps {
    title: string;
    count?: number;
    subtitle?: ReactNode;
    defaultOpen?: boolean;
    children: ReactNode;
    className?: string;
}

export function CollapsibleSection({ title, count, subtitle, defaultOpen = true, children, className = "" }: CollapsibleSectionProps) {
    return (
        <details className={`bg-white rounded-2xl shadow-sm border border-teal-100 group ${className}`} open={defaultOpen}>
            <summary className="p-5 cursor-pointer list-none flex justify-between items-center hover:bg-teal-50 transition-colors rounded-2xl group-open:rounded-t-2xl group-open:rounded-b-none">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 flex-1 min-w-0">
                    <h3 className="text-xl font-semibold text-teal-900 tracking-tight">{title}</h3>
                    {count !== undefined && (
                        <span className="bg-teal-100 text-teal-700 text-xs font-semibold px-2 py-0.5 rounded-full">
                            {count}
                        </span>
                    )}
                    {subtitle && (
                        <div className="text-xs text-stone-600 font-medium flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            {subtitle}
                        </div>
                    )}
                </div>
                <svg className="w-5 h-5 text-teal-700 transform group-open:rotate-180 transition-transform flex-shrink-0 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </summary>

            <div className="px-5 pb-5 border-t border-teal-100 pt-5 animate-in slide-in-from-top-2 fade-in duration-200 rounded-b-2xl">
                {children}
            </div>
        </details>
    );
}
