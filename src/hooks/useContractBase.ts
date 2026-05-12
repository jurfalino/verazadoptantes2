'use client';

import { useEffect, useState } from 'react';

let cached: Promise<string> | null = null;

function load(): Promise<string> {
    if (!cached) {
        cached = fetch('/api/contract-base', { cache: 'force-cache' })
            .then((r) => r.json() as Promise<{ url: string }>)
            .then((j) => j.url.replace(/\/+$/, ''))
            .catch(() => {
                cached = null;
                return '';
            });
    }
    return cached;
}

export function useContractBase(): string | null {
    const [value, setValue] = useState<string | null>(null);
    useEffect(() => {
        let alive = true;
        load().then((url) => {
            if (alive && url) setValue(url);
        });
        return () => {
            alive = false;
        };
    }, []);
    return value;
}
