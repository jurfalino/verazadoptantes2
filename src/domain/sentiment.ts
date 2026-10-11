/**
 * Lexicon-based Spanish sentiment scoring for adopter activity notes, tuned to
 * the vetting domain (cruelty/abandonment/breeding-resale vs. commitment/
 * sterilization/follow-up compliance). Powers the "Calificaciones vs. notas"
 * data-quality report: records whose rating disagrees with — or was never
 * supported by — their own text.
 *
 * Pure domain module: no DB, no server imports. The score is a review aid for
 * moderators, never an automatic rater (measured Spearman ρ ≈ 0.22 against
 * ratings on the 2026-09 production corpus — far too weak to rate anyone).
 */

import { noteHash } from './notePii';

/**
 * Lower-case and strip accents so lexicon entries match all spellings, and undo
 * digit-for-vowel spelling inside words ("mutil4r", "mat4r") that warning posts
 * use to dodge social-media filters. Standalone numbers are untouched.
 */
function normalize(s: string): string {
    return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[a-z]+[0-9][a-z0-9]*[a-z]/g, w => w.replace(/4/g, 'a').replace(/3/g, 'e').replace(/1/g, 'i').replace(/0/g, 'o'));
}

/**
 * Strip text that carries no sentiment about the adopter before scoring:
 * import source lines ("Fuente: Listado de Malos Adoptantes…" would otherwise
 * score "malos"), "cargado por …" attributions, appended "Contact:" blocks,
 * URLs, and phone-like digit runs. Cleaning is scoring hygiene only — queue
 * membership never depends on matching a source string.
 */
export function cleanNoteForSentiment(text: string): string {
    return text
        .replace(/https?:\/\/\S+/g, ' ')
        .replace(/Fuente:\s*Listado de Malos Adoptantes[^.]*(\.|$)/gi, ' ')
        .replace(/cargado por[^.\n]*/gi, ' ')
        .replace(/Contact:[\s\S]*$/i, ' ')
        .replace(/[\d\-.+()]{6,}/g, ' ')
        .trim();
}

// Multi-word patterns matched (and consumed) before single words, so
// "no quiere castrar" never also scores "castrar" as positive.
// Patterns are written against normalized (lower-case, accent-free) text.
const PHRASES: [RegExp, number][] = [
    // strong negative
    [/mala? adoptante/g, -3],
    [/no (se lo|se la|le|les) (dio|entrego|entregaron)/g, -1],
    [/no recomendabl\w+/g, -3],
    [/lista negra/g, -3],
    [/(tiro|tiraron|arrojo|arrojaron|dejo|dejaron|abandono|abandonaron)\w* (a la|en la) calle/g, -3],
    [/para (hacer )?cria/g, -3],
    [/para (la )?venta/g, -3],
    [/para vender/g, -3],
    [/(vende|venden|vendio|vendieron) (los )?(animales|perros|gatos|cachorros|gatitos)/g, -3],
    [/no (quiere|quiso|va a) castrar/g, -2],
    [/sin castrar/g, -1],
    [/no (contesta|responde|respondio|atiende)/g, -2],
    [/no permite (seguimiento|visita)/g, -2],
    [/corto (el )?contacto/g, -2],
    [/perdio (el|al) (gato|perro|animal)/g, -2],
    [/se (escapo|escaparon|perdio|perdieron)/g, -1],
    [/se hace pasar/g, -3],
    [/no (le |les )?(entreguen|entregar|den|des)\b/g, -3],
    [/no (quiere|quiso|acepta|acepto) (el |ningun )?compromiso/g, -2],
    [/\bmutil\w*/g, -3],
    [/\btortur\w*/g, -3],
    [/en mal estado/g, -2],
    [/estado deplorable/g, -3],
    // strong positive
    [/(muy )?buen(a)? adoptante/g, 3],
    [/excelente adoptante/g, 3],
    [/muy buen\w*/g, 2],
    [/todo (en orden|bien|ok)/g, 2],
    [/sigue en contacto/g, 2],
    [/manda fotos/g, 2],
    [/envia fotos/g, 2],
    [/paso (el|la) seguimiento/g, 2],
    [/compromiso de (vacunacion|castracion)/g, 2],
    [/red(es)? de proteccion/g, 2],
    [/proteccion en (balcon|terraza|ventana)/g, 2],
    [/adopcion exitosa/g, 3],
    [/se comprometio/g, 1],
    [/en perfectas condiciones/g, 1],
];

// Single-word weights (normalized spelling). ±3 strong, ±1 mild.
const WORDS: Record<string, number> = {
    // negative: cruelty / death / abandonment
    mato: -3, matar: -3, asesino: -3, asesina: -3, murio: -2, fallecio: -2, muerto: -2, muerta: -2,
    maltrato: -3, maltrata: -3, maltratado: -3, maltratada: -3, golpea: -3, pateada: -2, pateado: -2,
    abandono: -3, abandonado: -3, abandonada: -3, abandonar: -3, abandonaron: -3,
    tiro: -1, tiraron: -2, echo: -1, echaron: -1, regalo: -1, regalaron: -1,
    devolvio: -2, devuelto: -2, devuelta: -2, devolucion: -2, rechazada: -1, rechazado: -1,
    desnutrido: -2, desnutrida: -2, enfermo: -1, enferma: -1, lastimado: -2, lastimada: -2,
    desaparecio: -2, desaparecida: -2, desaparecido: -2, desaparecidos: -2, desaparecieron: -2,
    robo: -2, roba: -2, robar: -2, robado: -2, robada: -2, robados: -2, robaron: -2,
    bloqueo: -2, bloqueado: -1, bloqueada: -1,
    irresponsable: -3, irresponsables: -3, reticente: -2,
    denuncia: -2, denunciada: -2, denunciado: -2, denuncias: -2,
    amenaza: -2, amenazar: -2, amenazo: -2, insulta: -2, insultar: -2, insulto: -2,
    agresivo: -2, agresiva: -2, violento: -2, violenta: -2,
    estafa: -3, estafador: -3, estafadora: -3, miente: -2, mintio: -2, mentira: -2,
    falso: -1, falsa: -1, engano: -2,
    criadero: -3, cria: -1, vender: -2, vende: -2, venta: -1,
    peligroso: -3, peligrosa: -3, cuidado: -1, ojo: -1, alerta: -1, hdp: -3,
    mal: -1, mala: -1, malos: -1, pesimo: -3, pesima: -3, terrible: -2, horrible: -2,
    sucio: -1, sucia: -1, mugre: -2, acumuladora: -2, acumulador: -2,
    zoofilia: -3, envenenado: -3, enveneno: -3, sacrificar: -2, atado: -1, atada: -1, encadenado: -2,
    preso: -2, carcel: -2, policia: -1, desconfiar: -2, sospechoso: -1, sospechosa: -1,
    // positive: care / responsibility
    excelente: 3, excelentes: 3, responsable: 2, responsables: 2,
    recomendable: 2, recomendado: 2, recomendada: 2,
    bueno: 1, buena: 1, buenos: 1, buenas: 1, buen: 1, genial: 2, perfecto: 2, perfecta: 2,
    carinoso: 2, carinosa: 2, amoroso: 2, amorosa: 2, dedicado: 2, dedicada: 2, atento: 1, atenta: 1,
    castro: 2, castrada: 1, castrado: 1, castracion: 1,
    vacuno: 1, vacunado: 1, vacunada: 1, vacunacion: 1,
    veterinario: 1, veterinaria: 1, desparasitado: 1, desparasitada: 1,
    compromiso: 1, comprometio: 1, comprometida: 1, comprometido: 1,
    feliz: 2, felices: 2, contento: 1, contenta: 1, encanta: 2, adora: 2, ama: 1, aman: 1,
    querido: 1, querida: 1,
    cuidan: 1, cuida: 1, cuidada: 1,
    seguimiento: 1, fotos: 1, confiable: 2, confianza: 1,
    rescato: 1, rescatista: 1, transito: 1, ayuda: 1, ayudo: 1, colabora: 1,
};

const NEGATORS = new Set(['no', 'nunca', 'jamas', 'sin', 'ni', 'tampoco']);

export interface SentimentResult {
    /** Bounded score, −4…+4. Null when the cleaned text is empty. */
    score: number | null;
    /** true when at least one lexicon entry matched — score is meaningful. */
    hasSignal: boolean;
    /** The cleaned text the score was computed from (excerpt source for UIs). */
    cleaned: string;
    /**
     * Sum of the negative contributions alone (≤ 0), before clamping. A warning
     * post praises the con ("buena dicción, te ofrece ayuda… ya ha robado"), so
     * a positive net score can still carry clear negative evidence.
     */
    negative: number;
}

/** Score one note. Negated words (negator within the 3 preceding tokens) flip sign and damp ×0.5. */
export function scoreNoteSentiment(rawText: string): SentimentResult {
    const cleaned = cleanNoteForSentiment(rawText);
    let t = normalize(cleaned);
    if (t.length < 3) return { score: null, hasSignal: false, cleaned, negative: 0 };

    let total = 0;
    let hits = 0;
    let negative = 0;
    for (const [pattern, weight] of PHRASES) {
        const matches = t.match(pattern);
        if (matches) {
            total += weight * matches.length;
            if (weight < 0) negative += weight * matches.length;
            hits += matches.length;
            t = t.replace(pattern, ' ');
        }
    }
    const tokens = t.match(/[a-z]+/g) ?? [];
    for (let i = 0; i < tokens.length; i++) {
        let w = WORDS[tokens[i]];
        if (w === undefined) continue;
        const windowStart = Math.max(0, i - 3);
        for (let j = windowStart; j < i; j++) {
            if (NEGATORS.has(tokens[j])) { w = -w * 0.5; break; }
        }
        total += w;
        if (w < 0) negative += w;
        hits++;
    }
    if (hits === 0) return { score: 0, hasSignal: false, cleaned, negative };
    return { score: Math.max(-4, Math.min(4, total)), hasSignal: true, cleaned, negative };
}

export type RatingsAuditQueue = 'upgrade' | 'downgrade' | 'to_one' | 'no_evidence' | 'neutral_evidence';

/**
 * Assign a record to a ratings-audit queue, or null when rating and text agree.
 * Queues are mutually exclusive. Thresholds calibrated on the 2026-09 corpus:
 *  - upgrade:          rating ≤ 2 with clearly positive text (score ≥ +2) and no
 *                      real negative evidence (negative > −2: one mild word like
 *                      "ojo"/"cuidado" is tolerated, a strong one or two mild vetoes).
 *                      Without the veto, all 9 production upgrade rows on
 *                      2026-10-09 were warning posts; the one past real catch
 *                      ("todo muy bien… siempre nos manda fotos") still passes.
 *  - downgrade:        rating ≥ 4 with negative text (score ≤ −1)
 *  - to_one:           rating 2–3 with strongly negative text (score ≤ −3)
 *  - no_evidence:      rating 2 with no sentiment-bearing words and no cleaned text
 *  - neutral_evidence: rating 2 with no sentiment-bearing words but some neutral text
 */
export function classifyRatingsAudit(rating: number | null, sentiment: SentimentResult): RatingsAuditQueue | null {
    if (sentiment.hasSignal && rating !== null && sentiment.score !== null) {
        if (rating <= 2 && sentiment.score >= 2 && sentiment.negative > -2) return 'upgrade';
        if (rating >= 4 && sentiment.score <= -1) return 'downgrade';
        if ((rating === 2 || rating === 3) && sentiment.score <= -3) return 'to_one';
        return null;
    }
    if (rating === 2 && !sentiment.hasSignal) {
        return sentiment.cleaned.length < 5 ? 'no_evidence' : 'neutral_evidence';
    }
    return null;
}

/**
 * Identity of what a reviewer saw when they marked a row "Está bien así": the
 * rating plus both note fields. A review holds only while this is unchanged, so
 * editing the rating or the note (by any write path) puts the row back.
 */
export function ratingsAuditFingerprint(rating: number | null, details: string | null, comments: string | null): string {
    return noteHash(`${rating ?? ''}\u0000${details ?? ''}\u0000${comments ?? ''}`);
}
