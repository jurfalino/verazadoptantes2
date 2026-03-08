import { NextResponse } from 'next/server';

/** Exact origins always allowed */
const EXACT_ORIGINS = [
    'http://localhost:3001',    // local dev (Vite)
    'http://localhost:5173',    // Vite default port fallback
];

/** Suffix patterns: any origin ending with these is allowed */
const ORIGIN_SUFFIXES = [
    '.contrato-duj.pages.dev', // all CF Pages deployments (hash-based previews + production)
    '.contrato.pages.dev',     // future: if custom name is configured
];

function isAllowedOrigin(origin: string): boolean {
    if (EXACT_ORIGINS.includes(origin)) return true;
    return ORIGIN_SUFFIXES.some(suffix => origin.endsWith(suffix));
}

/** Add CORS headers to a response for the contract API */
export function withCors(response: NextResponse, requestOrigin: string | null): NextResponse {
    const origin = requestOrigin && isAllowedOrigin(requestOrigin) ? requestOrigin : EXACT_ORIGINS[0];
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type');
    response.headers.set('Access-Control-Max-Age', '86400');
    return response;
}

/** Handle CORS preflight (OPTIONS) request */
export function corsPreflightResponse(requestOrigin: string | null): NextResponse {
    const res = new NextResponse(null, { status: 204 });
    return withCors(res, requestOrigin);
}
