export const ADMIN_EMAILS = [
    'gatitosolivos@gmail.com',
    // Add other admin emails here
];

export function isAdmin(email: string | null | undefined): boolean {
    if (!email) return false;
    return ADMIN_EMAILS.includes(email);
}
