'use server';

/**
 * Append-only contribution path (the browser door). The implementation and
 * its full contract live in src/lib/contactEntryAdd.ts; here the owner and
 * editors are always told.
 */
import { addContactEntryFor, type AddContactEntryInput } from '@/lib/contactEntryAdd';

export type { AddContactEntryStatus } from '@/lib/contactEntryAdd';

export async function addContactEntry(input: AddContactEntryInput): ReturnType<typeof addContactEntryFor> {
    return addContactEntryFor(input, { notifyApprovers: true });
}
