/**
 * A household «No, es otra persona» is recorded as an answer for the pair (spec
 * 2026-11-05) — but only for a profile the server's own «¿Es este perfil?» check
 * offered for this input. Anything else (a forged id) is dropped and counted, so
 * nobody can mark an arbitrary profile "a different person" from here.
 */
export function keepOffered(rejected: readonly unknown[] | undefined, offered: readonly string[]): { kept: string[]; dropped: number } {
    const offeredSet = new Set(offered);
    const kept: string[] = [];
    let dropped = 0;
    for (const id of rejected ?? []) {
        if (typeof id === 'string' && offeredSet.has(id)) { if (!kept.includes(id)) kept.push(id); }
        else dropped++;
    }
    return { kept, dropped };
}
