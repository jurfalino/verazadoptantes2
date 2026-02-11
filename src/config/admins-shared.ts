// Client-safe admin check — does NOT import any server-only modules.
// Use this in 'use client' components. For async DB-backed checks, use isAdminAsync from '@/config/admins'.

const BOOTSTRAP_ADMIN_EMAILS = [
    'gatitosolivos@gmail.com',
];

/**
 * Synchronous check: returns true if the email is in the bootstrap list.
 * Safe to use from client components.
 */
export function isAdmin(email: string | null | undefined): boolean {
    if (!email) return false;
    return BOOTSTRAP_ADMIN_EMAILS.includes(email);
}
