/**
 * Collapse duplicate-match evidence for display.
 *
 * "The full name matched" entails "each of its words matched", so the tokenizer
 * emits `name_full` AND `name_word` from a single name and the dedup card
 * rendered the same fact twice — `Nombre completo: luis igartua` beside
 * `Nombre: igartua, luis`. That reads as two independent corroborations when it
 * is one, on a screen whose whole job is judging how much corroboration exists.
 *
 * Presentation only: the stored score is unchanged (that double-count is a
 * scoring problem, tracked separately). A name word matched OUTSIDE the full
 * name — a surname shared with an alias, say — is genuine extra evidence and
 * keeps its chip.
 */
export function collapseNameEvidence(values: Record<string, string[]>): Record<string, string[]> {
    const fulls = values.name_full ?? [];
    const words = values.name_word ?? [];
    if (fulls.length === 0 || words.length === 0) return values;

    const inFull = new Set(fulls.flatMap(f => f.toLowerCase().split(/\s+/).filter(Boolean)));
    const extra = words.filter(w => !inFull.has(w.toLowerCase()));

    const out = { ...values };
    if (extra.length > 0) out.name_word = extra;
    else delete out.name_word;
    return out;
}
