/**
 * «Te escribió» on the pair (Pendientes de revisar, approved 2026-11-11): the
 * messages sent with «Escribirle a …» are kept on the merge request
 * (`pair_messages`), not only in the bell, so archiving the notice loses
 * nothing. Shown to everyone who sees the pair. Pure.
 */

export type PairMessageRow = { id: string; senderEmail: string; senderName: string | null; body: string; createdAt: number };

/** What the viewer's browser gets: a name (never an address), whether it is theirs, the text, when (epoch s). */
export type PairMessageView = { id: string; senderName: string; mine: boolean; body: string; createdAt: number };

const norm = (e: string) => e.trim().toLowerCase();
const handle = (email: string) => {
    const at = email.indexOf('@');
    return at > 0 ? email.slice(0, at) : email;
};

/** Oldest first (ties by id), the viewer's own marked `mine`. */
export function pairMessageViews(rows: readonly PairMessageRow[], viewer: string): PairMessageView[] {
    const me = norm(viewer);
    return [...rows]
        .sort((a, b) => (a.createdAt - b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map(r => ({
            id: r.id,
            senderName: r.senderName?.trim() || handle(r.senderEmail.trim()),
            mine: norm(r.senderEmail) === me,
            body: r.body,
            createdAt: r.createdAt,
        }));
}
