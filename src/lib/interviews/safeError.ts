/**
 * Drizzle query errors embed the bound parameters ("\nparams: ...") in their
 * message, which here would be prep facts or answers. Logs get this instead.
 */
const cut = (m: string): string => {
    const i = m.indexOf('\nparams:');
    return i === -1 ? m : m.slice(0, i);
};

export function safeError(e: unknown): Error {
    if (!(e instanceof Error)) return new Error(cut(String(e)));
    let msg = cut(e.message);
    if (e.cause instanceof Error) msg += ` | cause: ${cut(e.cause.message)}`;
    const out = new Error(msg);
    out.name = e.name;
    return out;
}
