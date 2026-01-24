'use client';

import { ReactNode } from "react";

interface CollapsibleSectionProps {
    title: string;
    count?: number;
    defaultOpen?: boolean;
    children: ReactNode;
    className?: string; // Allow overrides if needed
}

export function CollapsibleSection({ title, count, defaultOpen = true, children, className = "" }: CollapsibleSectionProps) {
    return (
        <details className={`bg-white rounded-2xl shadow-sm border border-emerald-100/60 overflow-hidden group ${className}`} open={defaultOpen}>
            <summary className="p-5 cursor-pointer list-none flex justify-between items-center hover:bg-emerald-50/50 transition-colors">
                <div className="flex items-center gap-3">
                    <h3 className="text-xl font-bold text-emerald-900 tracking-tight">{title}</h3>
                    {count !== undefined && (
                        <span className="bg-emerald-100 text-emerald-700 text-xs font-bold px-2 py-0.5 rounded-full">
                            {count}
                        </span>
                    )}
                </div>
                <svg className="w-5 h-5 text-emerald-400 transform group-open:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </summary>

            <div className="px-5 pb-5 border-t border-emerald-100/50 pt-5 animate-in slide-in-from-top-2 fade-in duration-200">
                {children}
            </div>
        </details>
    );
}
