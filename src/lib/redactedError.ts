/**
 * Errors from lookups bound to contact values, with those values cut out, so a
 * failed query can be logged. No dependencies: safe to import anywhere.
 */
/** Drizzle ends a failed query's message with "params: <bound values>" — the phone, email or
 *  DNI looked up. Everything from there on is cut; the SQL (placeholders only) stays. */
const cutParams = (msg: string) => { const i = msg.indexOf('params:'); return (i === -1 ? msg : msg.slice(0, i)).trim(); };

/**
 * The same error with its message, stack and cause chain cut before "params:", so a
 * failed lookup can be logged without the contact values it was bound to.
 * Fields for a warn: `{ error, errorName, cause? }`.
 */
export function redactedError(e: unknown, depth = 0): Error {
    const src = e instanceof Error ? e : new Error(String(e));
    const out = new Error(cutParams(src.message));
    out.name = src.name;
    const frames = (src.stack ?? '').split('\n').filter(l => /^\s+at /.test(l));
    out.stack = [`${out.name}: ${out.message}`, ...frames].join('\n');
    const cause = (src as { cause?: unknown }).cause;
    if (cause !== undefined && depth < 3) (out as { cause?: unknown }).cause = redactedError(cause, depth + 1);
    return out;
}
export function redactedErrorFields(e: unknown): { error: string; errorName: string; cause?: Array<{ name: string; message: string }> } {
    const r = redactedError(e);
    const cause: Array<{ name: string; message: string }> = [];
    for (let c = (r as { cause?: unknown }).cause; c instanceof Error; c = (c as { cause?: unknown }).cause) cause.push({ name: c.name, message: c.message });
    return { error: r.message, errorName: r.name, ...(cause.length ? { cause } : {}) };
}
