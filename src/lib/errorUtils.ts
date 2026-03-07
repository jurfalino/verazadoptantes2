/**
 * Extract an Error ID from a server action error message.
 * Server actions embed IDs like: "Failed to save (Error ID: abc12345)"
 * or "Search failed (ID: abc12345)"
 */
export function extractErrorId(error: unknown): string | undefined {
    const msg = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
    const match = msg.match(/\(?(?:Error )?ID:\s*([a-f0-9-]{6,})\)?/i);
    return match?.[1];
}
