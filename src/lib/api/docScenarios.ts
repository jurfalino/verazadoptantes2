/**
 * Exact-search scenarios for the API docs: for each situation a partner must
 * handle (each rating, alerts, a shared phone, unknown, ambiguous), WHAT is
 * already registered in BuenAdoptante, the exact REQUEST that leads there, and
 * the ANSWER it gets.
 *
 * The answer is not hand-written: it is worked out from the registered profiles
 * and the request with the same decision the API uses (decideExactOutcome,
 * pickBestMatch's order), so a request and its answer can't disagree.
 *
 * The SAME definitions seed the demo people on staging (src/lib/api/demoSeed.ts),
 * so every documented request really returns the documented answer there.
 */
import { decideExactOutcome, type NameMatchedAs } from '@/domain/apiExactMatch';
import { saveActionOf } from './schemas';

type Level = 0 | 1 | 2 | 3 | 4 | 5;
const LABELS = ['not_rated', 'dangerous', 'poor', 'average', 'good', 'excellent'] as const;
export const ratingOf = (avg: number | null) => {
    const level = (avg === null ? 0 : Math.min(5, Math.max(1, Math.round(avg)))) as Level;
    return { rating: avg === null ? null : Math.round(avg * 10) / 10, ratingLevel: level, ratingLabel: LABELS[level] };
};

/** One past record on a registered profile; dates are relative to today. */
export interface PastRecord {
    type: 'adoption' | 'adoption_request' | 'follow_up' | 'observation';
    rating?: number;
    daysAgo: number;
    /** The rescue that registered it (its email). Different emails = different rescues. */
    by?: string;
}

export interface Registered {
    id: string;
    name: string;
    email?: string;
    phone?: string;
    documentId?: string;
    /** Set by people in BuenAdoptante (adopter_flags.reason). */
    marks?: Array<'inaccurate_information' | 'duplicate' | 'verified_identity'>;
    /** BuenAdoptante found another profile that may be the same person (a pending duplicate candidate). */
    possibleDuplicate?: boolean;
    history: PastRecord[];
}

export const DEFAULT_RESCUE = 'rescate-demo-1@example.com';
const rescue = (n: number) => `rescate-demo-${n}@example.com`;

interface ScenarioDef {
    key: string;
    title: string;
    /** What is already in BuenAdoptante, in words. */
    registered: string;
    profiles: Registered[];
    person: { fullName: string; email?: string; phone?: string; documentId?: { value: string; country?: string } };
    activity?: Record<string, unknown>;
    dryRun?: boolean;
    /** Why the answer comes out this way. */
    why: string;
}

const IDENTIFIERS = ['email', 'phone', 'documentId'] as const;
type Identifier = typeof IDENTIFIERS[number];
const digits = (s: string) => (s.match(/\d/g) ?? []).join('');
const keyOf: Record<Identifier, (v: string) => string> = {
    email: v => v.trim().toLowerCase(),
    phone: v => digits(v).slice(-8),
    documentId: v => digits(v),
};

const DEFS: ScenarioDef[] = [
    {
        key: 'five_stars',
        title: '5★ excelente, sin alertas',
        registered: 'Un perfil «María José Pérez» con el teléfono 11 5550-3101, con una adopción y cuatro seguimientos calificados (promedio 4,8) e identidad verificada.',
        profiles: [{
            id: 'demo-api-maria', name: 'María José Pérez', phone: '11 5550-3101', marks: ['verified_identity'],
            history: [
                { type: 'adoption', rating: 5, daysAgo: 400 }, { type: 'follow_up', rating: 5, daysAgo: 370 }, { type: 'follow_up', rating: 5, daysAgo: 200 },
                { type: 'follow_up', rating: 5, daysAgo: 170 }, { type: 'follow_up', rating: 4, daysAgo: 48 },
            ],
        }],
        person: { fullName: 'María José Pérez', phone: '+54 9 11 5550-3101', email: 'mariajose.demo@example.com' },
        activity: { activityType: 'adoption_request', animalName: 'Luna', species: 'dog' },
        why: 'El nombre y el teléfono (escrito en otro formato: es el mismo número) coinciden con un solo perfil → `found`. Su perfil no tenía ese email: se agrega y te lo decimos en `saved.contactsAdded`. `saved.action`: `added_to_profile`.',
    },
    {
        key: 'four_stars',
        title: '4★ bueno',
        registered: 'Un perfil «Lucía Fernández» con el email lucia.fernandez.demo@example.com, con una adopción y una solicitud calificadas 4 e identidad verificada.',
        profiles: [{
            id: 'demo-api-lucia', name: 'Lucía Fernández', email: 'lucia.fernandez.demo@example.com', marks: ['verified_identity'],
            history: [{ type: 'adoption_request', rating: 4, daysAgo: 160 }, { type: 'adoption', rating: 4, daysAgo: 150 }],
        }],
        person: { fullName: 'Lucía Fernández', email: 'Lucia.Fernandez.Demo@example.com' },
        activity: { activityType: 'adoption_request', animalName: 'Tom', species: 'cat' },
        why: 'El email coincide (mayúsculas no importan) y el nombre también → `found`. `verified_identity` es una buena señal: por eso no aparece en `risk.flags`.',
    },
    {
        key: 'three_stars',
        title: '3★ regular',
        registered: 'Un perfil «Jorge Luis Ramírez» con el DNI 99.913.502, con cinco registros calificados (promedio 3,2).',
        profiles: [{
            id: 'demo-api-jorge', name: 'Jorge Luis Ramírez', documentId: '99.913.502',
            history: [
                { type: 'adoption_request', rating: 3, daysAgo: 300 }, { type: 'adoption_request', rating: 3, daysAgo: 250 },
                { type: 'adoption_request', rating: 3, daysAgo: 120 }, { type: 'adoption', rating: 4, daysAgo: 110 }, { type: 'follow_up', rating: 3, daysAgo: 90 },
            ],
        }],
        person: { fullName: 'Jorge Ramírez', documentId: { value: '99913502', country: 'AR' } },
        activity: { activityType: 'adoption_request' },
        why: 'El documento coincide (los puntos no importan) y «Jorge Ramírez» es compatible con «Jorge Luis Ramírez» (todas sus palabras están en el nombre registrado) → `found`. Un 3★ no impide adoptar: miralo con más cuidado.',
    },
    {
        key: 'two_stars',
        title: '2★ malo, posible duplicado',
        registered: 'Un perfil «Carla Gómez» con el teléfono 11 5550-3104, con dos solicitudes calificadas 2, que BuenAdoptante detectó como posible duplicado de otro perfil.',
        profiles: [{
            id: 'demo-api-carla', name: 'Carla Gómez', phone: '11 5550-3104', possibleDuplicate: true,
            history: [{ type: 'adoption_request', rating: 2, daysAgo: 140 }, { type: 'observation', rating: 2, daysAgo: 115 }],
        }],
        person: { fullName: 'Carla Gómez', phone: '1155503104' },
        activity: { activityType: 'adoption_request' },
        why: 'Teléfono y nombre coinciden → `found`. `possible_duplicate` aparece en `risk.flags`: puede tener otro perfil con más historia.',
    },
    {
        key: 'one_star',
        title: '1★ peligroso, con alertas',
        registered: 'Un perfil «Diego Sosa» con el teléfono 11 5550-3105 y el email diego.sosa.demo@example.com, calificado 1,3, marcado con datos no confiables, que en los últimos 4 días pidió adoptar en 4 rescates distintos.',
        profiles: [{
            id: 'demo-api-diego', name: 'Diego Sosa', phone: '11 5550-3105', email: 'diego.sosa.demo@example.com', marks: ['inaccurate_information'],
            history: [
                { type: 'observation', rating: 1, daysAgo: 200 }, { type: 'observation', rating: 1, daysAgo: 180 },
                { type: 'adoption_request', rating: 2, daysAgo: 60 },
                { type: 'adoption_request', daysAgo: 4, by: rescue(1) }, { type: 'adoption_request', daysAgo: 3, by: rescue(2) },
                { type: 'adoption_request', daysAgo: 2, by: rescue(3) }, { type: 'adoption_request', daysAgo: 1, by: rescue(4) },
            ],
        }],
        person: { fullName: 'Diego Sosa', phone: '11 5550-3105', email: 'diego.sosa.demo@example.com' },
        activity: { activityType: 'adoption_request', animalName: 'Rocco', species: 'dog' },
        why: 'Email, teléfono y nombre coinciden → `found`. `ratingLevel` 1 (`dangerous`): **en BuenAdoptante, 1★ impide adoptar**. `risk.flags` trae `inaccurate` y `risk.alerts` trae `too_many_requests` (4 rescates distintos en pocos días). No entregues el animal.',
    },
    {
        key: 'not_rated',
        title: 'Conocida, nunca calificada',
        registered: 'Un perfil «Ana Torres» con el email ana.torres.demo@example.com, con una solicitud anterior y sin calificación.',
        profiles: [{ id: 'demo-api-ana', name: 'Ana Torres', email: 'ana.torres.demo@example.com', history: [{ type: 'adoption_request', daysAgo: 45 }] }],
        person: { fullName: 'Ana Torres', email: 'ana.torres.demo@example.com' },
        activity: { activityType: 'adoption_request' },
        why: '`found`, con `ratingLevel` 0 (`not_rated`): nadie la calificó. No es ni buena ni mala señal; una calificación nunca se infiere.',
    },
    {
        key: 'shared_phone',
        title: '4★, pero su teléfono también es de alguien 1★',
        registered: 'Un perfil «Pablo Ruiz» (4,2) y otro perfil «Ramón Ruiz» (1,0, cinco adopciones en la última semana), los dos con el teléfono 11 5550-3107 — un teléfono familiar.',
        profiles: [
            {
                id: 'demo-api-pablo', name: 'Pablo Ruiz', phone: '11 5550-3107',
                history: [{ type: 'adoption', rating: 4, daysAgo: 220 }, { type: 'follow_up', rating: 4, daysAgo: 200 }, { type: 'follow_up', rating: 4, daysAgo: 150 }, { type: 'follow_up', rating: 4, daysAgo: 100 }, { type: 'follow_up', rating: 5, daysAgo: 50 }],
            },
            {
                id: 'demo-api-ramon', name: 'Ramón Ruiz', phone: '11 5550-3107',
                history: [7, 6, 5, 4, 3].map(d => ({ type: 'adoption' as const, rating: 1, daysAgo: d })),
            },
        ],
        person: { fullName: 'Pablo Ruiz', phone: '11 5550-3107' },
        activity: { activityType: 'adoption_request' },
        why: 'El teléfono coincide con dos perfiles, pero solo el nombre de Pablo encaja → `found` (Pablo, 4★). El otro aparece en `otherMatches`, y `risk` muestra la peor señal de **los dos**: 1★ y la alerta `too_many_adoptions` de Ramón. Revisá antes de decidir.',
    },
    {
        key: 'not_found',
        title: 'Persona desconocida',
        registered: 'Nadie registró ese email.',
        profiles: [],
        person: { fullName: 'Sofía Medina', email: 'sofia.medina.demo@example.com' },
        activity: { activityType: 'adoption_request', animalName: 'Mora', species: 'cat' },
        why: 'Ningún perfil tiene ese email → `not_found`. `saved.action` es `created_profile`: se creó su perfil con esta actividad. `risk` vacío.',
    },
    {
        key: 'name_mismatch',
        title: 'El teléfono es de otra persona',
        registered: 'Un perfil «Martín Ortiz» con el teléfono 11 5550-3109, con dos solicitudes calificadas 2.',
        profiles: [{ id: 'demo-api-martin', name: 'Martín Ortiz', phone: '11 5550-3109', history: [{ type: 'adoption_request', rating: 2, daysAgo: 190 }, { type: 'adoption_request', rating: 2, daysAgo: 175 }] }],
        person: { fullName: 'Valeria Castro', phone: '11 5550-3109' },
        activity: { activityType: 'adoption_request' },
        why: 'El teléfono es de un perfil con otro nombre → `ambiguous` (`name_mismatch`): nunca adivinamos que son la misma persona. `saved.action` es `created_profile_for_review`: la actividad va a un perfil nuevo que un admin revisa como posible duplicado. `risk` igual te muestra el 2★ de ese teléfono.',
    },
    {
        key: 'multiple_profiles',
        title: 'Dos perfiles con el mismo nombre y email',
        registered: 'Dos perfiles «Laura Díaz» con el email laura.diaz.demo@example.com: uno con el teléfono 11 5550-3110, calificado 3 y marcado como duplicado; el otro sin calificar.',
        profiles: [
            { id: 'demo-api-laura-a', name: 'Laura Díaz', email: 'laura.diaz.demo@example.com', phone: '11 5550-3110', marks: ['duplicate'], history: [{ type: 'adoption', rating: 3, daysAgo: 320 }] },
            { id: 'demo-api-laura-b', name: 'Laura Díaz', email: 'laura.diaz.demo@example.com', history: [{ type: 'adoption_request', daysAgo: 240 }] },
        ],
        person: { fullName: 'Laura Díaz', email: 'laura.diaz.demo@example.com', phone: '11 5550-3110' },
        activity: { activityType: 'adoption_request' },
        why: 'El nombre encaja con los dos perfiles → `ambiguous` (`multiple_profiles`). `saved.action` es `added_to_best_match`: la actividad va al que mejor coincide, el que tiene email **y** teléfono iguales (`demo-api-laura-a`); no se crea un perfil nuevo.',
    },
    {
        key: 'dry_run',
        title: 'Prueba sin guardar (X-Dry-Run: 1, solo staging)',
        registered: 'Nadie registró ese email.',
        profiles: [],
        person: { fullName: 'Sofía Medina', email: 'sofia.medina.demo@example.com' },
        activity: { activityType: 'adoption_request' },
        dryRun: true,
        why: 'La misma respuesta que una llamada real; `saved.action` dice lo que **haría** (`created_profile`) y `saved.dryRun: true` que no se guardó nada. En producción este header se rechaza (`403 dry_run_not_allowed`).',
    },
];

// ── Request examples (the guide's «Ejemplos de pedidos»): María is a demo person, so on staging they answer. ──
export const REQUEST_EXAMPLES = {
    minimal: {
        summary: 'Mínimo: registrar una solicitud (nombre + un contacto + tipo + tu id)',
        value: { mode: 'exact', person: { fullName: 'María José Pérez', phone: '11 5550-3101' }, activity: { activityType: 'adoption_request', externalId: 'ejemplo-minimo-1' } },
    },
    complete_request: {
        summary: 'Completo: una solicitud con todos los datos y las respuestas de tu formulario',
        value: {
            mode: 'exact',
            person: {
                fullName: 'María José Pérez', email: 'mariajose.demo@example.com', phone: '+54 9 11 5550-3101',
                documentId: { value: '99.555.310', country: 'AR' }, address: 'Av. Siempreviva 742, CABA',
                socials: [{ platform: 'instagram', handle: '@mariajose.demo' }, { platform: 'facebook', handle: 'facebook.com/mariajose.demo' }],
            },
            activity: {
                activityType: 'adoption_request', externalId: 'jotform-5512', animalName: 'Luna', species: 'dog',
                date: '2026-10-12', notes: 'Llamó dos veces preguntando por Luna.',
                formContent: { '¿Tenés patio?': 'Sí', '¿Quiénes viven en la casa?': ['2 adultos', '1 niño'], mascotas: [{ tipo: 'gato', edad: 3, castrado: true }] },
            },
        },
    },
    complete_adoption: {
        summary: 'Completo: una adopción con los datos del animal (species obligatorio; después adjuntá el contrato)',
        value: {
            mode: 'exact',
            person: { fullName: 'María José Pérez', phone: '+54 9 11 5550-3101', email: 'mariajose.demo@example.com', documentId: { value: '99.555.310', country: 'AR' } },
            activity: {
                activityType: 'adoption', externalId: 'adopcion-2026-118',
                animalName: 'Luna', species: 'cat', age: '2 años', sex: 'female', neutered: true,
                color: 'atigrada', microchip: '985112345678901',
                date: '2026-10-12', rating: 5, notes: 'Entrega en domicilio, todo en orden.',
            },
        },
    },
    fuzzy: {
        summary: 'Fuzzy: buscar a alguien sin registrar nada (como la búsqueda de la página de inicio)',
        value: { mode: 'fuzzy', person: { fullName: 'María Pérez', socials: [{ platform: 'instagram', handle: '@mariajose.demo' }] } },
    },
};

type ExamplePerson = { fullName?: string; email?: string; phone?: string; documentId?: { value: string } };
const foldName = (n: string) => n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
/** The docs' example people: their names and identifiers (production refuses them). */
const EXAMPLES = (() => {
    const people: ExamplePerson[] = [
        ...DEFS.map(d => d.person),
        ...DEFS.flatMap(d => d.profiles.map(p => ({ fullName: p.name, email: p.email, phone: p.phone, documentId: p.documentId ? { value: p.documentId } : undefined }))),
        ...Object.values(REQUEST_EXAMPLES).map(e => e.value.person as ExamplePerson),
    ];
    return {
        names: new Set(people.map(p => p.fullName).filter((n): n is string => !!n).map(foldName)),
        ids: new Set(people.flatMap(p => [
            p.email && `e:${keyOf.email(p.email)}`, p.phone && `p:${keyOf.phone(p.phone)}`, p.documentId && `d:${keyOf.documentId(p.documentId.value)}`,
        ]).filter((x): x is string => !!x)),
    };
})();
/** Is this one of the docs' example people — an example name AND one of the examples' identifiers? Pure. */
export function isExampleData(person: ExamplePerson): boolean {
    if (!person.fullName || !EXAMPLES.names.has(foldName(person.fullName))) return false;
    return [
        person.email && `e:${keyOf.email(person.email)}`, person.phone && `p:${keyOf.phone(person.phone)}`,
        person.documentId && `d:${keyOf.documentId(person.documentId.value)}`,
    ].some(k => !!k && EXAMPLES.ids.has(k));
}

/** Every profile the scenarios need registered (the staging demo seed). */
export function demoProfiles(): Registered[] {
    return DEFS.flatMap(d => d.profiles);
}
/** Names of the people the scenarios' requests may CREATE (cleaned up by a re-seed). */
export function demoCreatedNames(): string[] {
    return [...new Set(DEFS.map(d => d.person.fullName))];
}

/** The "too many" thresholds — admins change them per environment (app_config, getAdoptionConfig). */
export interface AlertConfig {
    threshold: number; periodDays: number;           // too_many_adoptions
    requestsThreshold: number; requestsPeriodDays: number; // too_many_requests
}
export const DEFAULT_ALERT_CONFIG: AlertConfig = { threshold: 5, periodDays: 90, requestsThreshold: 3, requestsPeriodDays: 30 };

/** Most items inside any window of `periodDays` (the same sliding window enrichAdopters uses). */
function densest<T>(items: Array<{ daysAgo: number; item: T }>, periodDays: number, measure: (inWindow: T[]) => number): number {
    const sorted = [...items].sort((a, b) => b.daysAgo - a.daysAgo); // oldest first
    let best = 0;
    for (let i = 0; i < sorted.length; i++) {
        const inWindow = sorted.filter(x => x.daysAgo <= sorted[i].daysAgo && sorted[i].daysAgo - x.daysAgo <= periodDays).map(x => x.item);
        best = Math.max(best, measure(inWindow));
    }
    return best;
}

const dayMs = 86_400_000;
const isoDay = (now: Date, daysAgo: number) => new Date(now.getTime() - daysAgo * dayMs).toISOString().slice(0, 10);

/** When the demo seed creates a profile: the day of its oldest record (so the docs know it). */
export function demoCreatedAt(p: Registered, now: Date): string {
    return isoDay(now, Math.max(...p.history.map(h => h.daysAgo)));
}

/** What BuenAdoptante computes for a registered profile: rating, record counts, last record, alerts. */
function computed(p: Registered, now: Date, cfg: AlertConfig) {
    const rated = p.history.map(h => h.rating).filter((r): r is number => typeof r === 'number');
    const avg = rated.length ? rated.reduce((a, b) => a + b, 0) / rated.length : null;
    const records: Record<string, number> = {};
    for (const h of p.history) records[h.type] = (records[h.type] ?? 0) + 1;
    const last = Math.min(...p.history.map(h => h.daysAgo));
    const alerts: Array<{ type: 'too_many_requests' | 'too_many_adoptions'; count: number; periodDays: number }> = [];
    // Same order as the API: requests first, then adoptions (profiles.ts).
    const rescues = densest(p.history.filter(h => h.type === 'adoption_request').map(h => ({ daysAgo: h.daysAgo, item: h.by ?? DEFAULT_RESCUE })),
        cfg.requestsPeriodDays, w => new Set(w).size);
    if (rescues >= cfg.requestsThreshold) alerts.push({ type: 'too_many_requests', count: rescues, periodDays: cfg.requestsPeriodDays });
    const placed = densest(p.history.filter(h => h.type === 'adoption').map(h => ({ daysAgo: h.daysAgo, item: 1 })), cfg.periodDays, w => w.length);
    if (placed >= cfg.threshold) alerts.push({ type: 'too_many_adoptions', count: placed, periodDays: cfg.periodDays });
    const flags: string[] = [];
    if (p.marks?.includes('inaccurate_information')) flags.push('inaccurate');
    if (p.marks?.includes('duplicate')) flags.push('duplicate');
    if (p.possibleDuplicate) flags.push('possible_duplicate');
    if (p.marks?.includes('verified_identity')) flags.push('verified_identity');
    return { avg, records, lastRecordAt: isoDay(now, last), alerts, flags };
}

const NOT_RISK = new Set(['verified_identity', 'verified_address']);

function matchedOn(req: ScenarioDef['person'], p: Registered): Identifier[] {
    const sent: Partial<Record<Identifier, string>> = { email: req.email, phone: req.phone, documentId: req.documentId?.value };
    return IDENTIFIERS.filter(k => sent[k] && p[k] && keyOf[k](sent[k]!) === keyOf[k](p[k]!));
}

/** Work out the answer the API gives, from the registered profiles and the request. */
function answer(def: ScenarioDef, origin: string, n: number, now: Date, cfg: AlertConfig) {
    const url = (id: string) => `${origin}/adopter/${id}`;
    const hits = def.profiles.filter(p => matchedOn(def.person, p).length > 0);
    const outcome = decideExactOutcome(def.person.fullName, hits.map(p => ({ profileId: p.id, name: p.name, aliases: [], householdNames: [] })));
    const byId = new Map(hits.map(p => [p.id, p]));
    const summary = (p: Registered) => {
        const c = computed(p, now, cfg);
        return {
            profileId: p.id, url: url(p.id), ...ratingOf(c.avg),
            flags: c.flags, alerts: c.alerts, records: c.records, lastRecordAt: c.lastRecordAt,
            createdAt: demoCreatedAt(p, now), registeredByYourRescue: false,
        };
    };
    const worst = (ps: Registered[]) => {
        const rated = ps.map(p => computed(p, now, cfg).avg).filter((a): a is number => a !== null);
        return ratingOf(rated.length ? Math.min(...rated) : null);
    };
    const flags = new Set<string>();
    const alerts: Array<Record<string, unknown>> = [];
    for (const p of hits) {
        const c = computed(p, now, cfg);
        for (const f of c.flags) if (!NOT_RISK.has(f)) flags.add(f);
        for (const a of c.alerts) alerts.push({ ...a, profileId: p.id });
    }
    const body: Record<string, unknown> = {
        requestId: `b1d0c8e2-0000-4000-8000-${String(n).padStart(12, '0')}`, mode: 'exact', match: outcome.result,
    };
    let savedOn: { id: string; created: boolean; contactsAdded: Identifier[] } | null = null;
    const added = (p: Registered | null): Identifier[] => {
        const sent: Partial<Record<Identifier, string>> = { email: def.person.email, phone: def.person.phone, documentId: def.person.documentId?.value };
        return p ? IDENTIFIERS.filter(k => sent[k] && !p[k]) : [];
    };
    if (outcome.result === 'found') {
        const p = byId.get(outcome.profileId)!;
        body.profile = { ...summary(p), matchedOn: matchedOn(def.person, p), nameMatchedAs: outcome.nameMatchedAs as NameMatchedAs };
        const others = outcome.otherProfileIds.map(id => byId.get(id)!);
        if (others.length) body.otherMatches = others.map(o => ({ profileId: o.id, url: url(o.id) }));
        savedOn = { id: p.id, created: false, contactsAdded: added(p) };
    } else if (outcome.result === 'ambiguous') {
        const fits = new Map(outcome.compatible.map(c => [c.profileId, c.as]));
        Object.assign(body, { reason: outcome.reason, candidates: outcome.profileIds.map(id => ({ profileId: id, url: url(id), nameMatchedAs: fits.get(id) ?? null })) });
        // Best match (pickBestMatch's first criterion: most identifiers matched); no name fits → a new profile.
        const fitting = outcome.compatible.map(c => byId.get(c.profileId)!)
            .sort((a, b) => matchedOn(def.person, b).length - matchedOn(def.person, a).length);
        savedOn = fitting.length ? { id: fitting[0].id, created: false, contactsAdded: added(fitting[0]) } : { id: `p_new_${def.key}`, created: true, contactsAdded: [] };
    } else {
        savedOn = { id: `p_new_${def.key}`, created: true, contactsAdded: [] };
    }
    body.risk = { worstRating: worst(hits), flags: [...flags].sort(), alerts, profilesMatched: hits.length };
    if (def.dryRun && savedOn) {
        body.saved = { action: saveActionOf(outcome.result, savedOn.created), dryRun: true };
    } else if (def.activity && savedOn) {
        const rid = `r_${def.key}`;
        body.saved = {
            action: saveActionOf(outcome.result, savedOn.created),
            activityId: rid, activityUrl: `${url(savedOn.id)}?record=${rid}`, profileId: savedOn.id, profileUrl: url(savedOn.id),
            contactsAdded: savedOn.contactsAdded,
        };
    } else {
        body.saved = { action: 'nothing_saved' };
    }
    return body;
}

export interface Scenario {
    key: string; title: string; registered: string; why: string; dryRun: boolean;
    request: Record<string, unknown>;
    response: Record<string, unknown>;
}

export function exactScenarios(origin: string, now: Date = new Date(), cfg: AlertConfig = DEFAULT_ALERT_CONFIG): Scenario[] {
    return DEFS.map((d, i) => ({
        key: d.key, title: d.title, registered: d.registered, why: d.why, dryRun: !!d.dryRun,
        request: { mode: 'exact', person: d.person, activity: { activityType: 'adoption_request', ...d.activity, externalId: `escenario-${i + 1}` } },
        response: answer(d, origin, i + 1, now, cfg),
    }));
}
