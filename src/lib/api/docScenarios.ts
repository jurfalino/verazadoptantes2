/**
 * Exact-search scenarios for the API docs: for each situation a partner must
 * handle (each rating, alerts, a shared phone, unknown, ambiguous), WHAT is
 * already registered in BuenAdoptante, the exact REQUEST that leads there, and
 * the ANSWER it gets.
 *
 * The answer is not hand-written: it is worked out from the registered profiles
 * and the request with the same decision the API uses (decideExactOutcome,
 * pickBestMatch's order), so a request and its answer can't disagree.
 */
import { decideExactOutcome, type NameMatchedAs } from '@/domain/apiExactMatch';

type Level = 0 | 1 | 2 | 3 | 4 | 5;
const LABELS = ['not_rated', 'dangerous', 'poor', 'average', 'good', 'excellent'] as const;
export const ratingOf = (avg: number | null) => {
    const level = (avg === null ? 0 : Math.min(5, Math.max(1, Math.round(avg)))) as Level;
    return { rating: avg === null ? null : Math.round(avg * 10) / 10, ratingLevel: level, ratingLabel: LABELS[level] };
};

interface Registered {
    id: string;
    name: string;
    email?: string;
    phone?: string;
    documentId?: string;
    avg: number | null;
    flags?: string[];
    tooManyRequests?: { count: number; periodDays: number };
    tooManyAdoptions?: { count: number; periodDays: number };
    records: Record<string, number>;
    lastRecordAt: string;
}

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
        registered: 'Un perfil «María José Pérez» con el teléfono 11 6462-2274, calificado 4,8 por los rescates que la conocen y con identidad verificada.',
        profiles: [{ id: 'p_maria', name: 'María José Pérez', phone: '11 6462-2274', avg: 4.8, flags: ['verified_identity'], records: { adoption: 2, follow_up: 3 }, lastRecordAt: '2026-08-30' }],
        person: { fullName: 'María José Pérez', phone: '+54 9 11 6462-2274', email: 'maria@example.com' },
        activity: { activityType: 'adoption_request', animalName: 'Luna', species: 'dog' },
        why: 'El nombre y el teléfono (escrito en otro formato: es el mismo número) coinciden con un solo perfil → `found`. Su perfil no tenía ese email: se agrega y te lo decimos en `activity.contactsAdded`.',
    },
    {
        key: 'four_stars',
        title: '4★ bueno',
        registered: 'Un perfil «Lucía Fernández» con el email lucia.fernandez@example.com, calificado 4,1 e identidad verificada.',
        profiles: [{ id: 'p_lucia', name: 'Lucía Fernández', email: 'lucia.fernandez@example.com', avg: 4.1, flags: ['verified_identity'], records: { adoption: 1, adoption_request: 1 }, lastRecordAt: '2026-05-14' }],
        person: { fullName: 'Lucía Fernández', email: 'Lucia.Fernandez@example.com' },
        activity: { activityType: 'adoption_request', animalName: 'Tom', species: 'cat' },
        why: 'El email coincide (mayúsculas no importan) y el nombre también → `found`. `verified_identity` es una buena señal: por eso no aparece en `risk.flags`.',
    },
    {
        key: 'three_stars',
        title: '3★ regular',
        registered: 'Un perfil «Jorge Luis Ramírez» con el DNI 28.456.789, calificado 3,2.',
        profiles: [{ id: 'p_jorge', name: 'Jorge Luis Ramírez', documentId: '28.456.789', avg: 3.2, records: { adoption_request: 3, adoption: 1, follow_up: 1 }, lastRecordAt: '2026-07-02' }],
        person: { fullName: 'Jorge Ramírez', documentId: { value: '28456789', country: 'AR' } },
        activity: { activityType: 'adoption_request' },
        why: 'El documento coincide (los puntos no importan) y «Jorge Ramírez» es compatible con «Jorge Luis Ramírez» (todas sus palabras están en el nombre registrado) → `found`. Un 3★ no impide adoptar: miralo con más cuidado.',
    },
    {
        key: 'two_stars',
        title: '2★ malo, posible duplicado',
        registered: 'Un perfil «Carla Gómez» con el teléfono 11 5521-0098, calificado 2,0, que BuenAdoptante detectó como posible duplicado de otro perfil.',
        profiles: [{ id: 'p_carla', name: 'Carla Gómez', phone: '11 5521-0098', avg: 2.0, flags: ['possible_duplicate'], records: { adoption_request: 2, returned_pet: 1 }, lastRecordAt: '2026-06-21' }],
        person: { fullName: 'Carla Gómez', phone: '1155210098' },
        activity: { activityType: 'adoption_request' },
        why: 'Teléfono y nombre coinciden → `found`. `possible_duplicate` aparece en `risk.flags`: puede tener otro perfil con más historia.',
    },
    {
        key: 'one_star',
        title: '1★ peligroso, con alertas',
        registered: 'Un perfil «Diego Sosa» con el teléfono 11 4789-3321 y el email diego.sosa@example.com, calificado 1,3, marcado con datos no confiables, que pidió adoptar en 4 rescates distintos en los últimos 30 días.',
        profiles: [{
            id: 'p_diego', name: 'Diego Sosa', phone: '11 4789-3321', email: 'diego.sosa@example.com', avg: 1.3, flags: ['inaccurate'],
            tooManyRequests: { count: 4, periodDays: 30 }, records: { adoption_request: 6, returned_pet: 2, observation: 1 }, lastRecordAt: '2026-10-01',
        }],
        person: { fullName: 'Diego Sosa', phone: '11 4789-3321', email: 'diego.sosa@example.com' },
        activity: { activityType: 'adoption_request', animalName: 'Rocco', species: 'dog' },
        why: 'Email, teléfono y nombre coinciden → `found`. `ratingLevel` 1 (`dangerous`): **en BuenAdoptante, 1★ impide adoptar**. `risk.flags` trae las dos alertas. No entregues el animal.',
    },
    {
        key: 'not_rated',
        title: 'Conocida, nunca calificada',
        registered: 'Un perfil «Ana Torres» con el email ana.torres@example.com, con una solicitud anterior y sin calificación.',
        profiles: [{ id: 'p_ana', name: 'Ana Torres', email: 'ana.torres@example.com', avg: null, records: { adoption_request: 1 }, lastRecordAt: '2026-09-02' }],
        person: { fullName: 'Ana Torres', email: 'ana.torres@example.com' },
        activity: { activityType: 'adoption_request' },
        why: '`found`, con `ratingLevel` 0 (`not_rated`): nadie la calificó. No es ni buena ni mala señal; una calificación nunca se infiere.',
    },
    {
        key: 'shared_phone',
        title: '4★, pero su teléfono también es de alguien 1★',
        registered: 'Un perfil «Pablo Ruiz» (4,2) y otro perfil «Ramón Ruiz» (1,0, adoptó muchos animales en poco tiempo), los dos con el teléfono 11 6033-4410 — un teléfono familiar.',
        profiles: [
            { id: 'p_pablo', name: 'Pablo Ruiz', phone: '11 6033-4410', avg: 4.2, records: { adoption: 1 }, lastRecordAt: '2026-03-10' },
            { id: 'p_ramon', name: 'Ramón Ruiz', phone: '11 6033-4410', avg: 1.0, tooManyAdoptions: { count: 5, periodDays: 90 }, records: { adoption: 5, returned_pet: 3 }, lastRecordAt: '2026-09-28' },
        ],
        person: { fullName: 'Pablo Ruiz', phone: '11 6033-4410' },
        activity: { activityType: 'adoption_request' },
        why: 'El teléfono coincide con dos perfiles, pero solo el nombre de Pablo encaja → `found` (Pablo, 4★). El otro aparece en `otherMatches`, y `risk` muestra la peor señal de **los dos**: 1★ y `too_many_adoptions`. Revisá antes de decidir.',
    },
    {
        key: 'not_found',
        title: 'Persona desconocida',
        registered: 'Nadie registró ese email.',
        profiles: [],
        person: { fullName: 'Sofía Medina', email: 'sofia.medina@example.com' },
        activity: { activityType: 'adoption_request', animalName: 'Mora', species: 'cat' },
        why: 'Ningún perfil tiene ese email → `not_found`. Se crea su perfil con esta actividad (`profileCreated: true`). `risk` vacío.',
    },
    {
        key: 'name_mismatch',
        title: 'El teléfono es de otra persona',
        registered: 'Un perfil «Martín Ortiz» con el teléfono 11 3344-5566, calificado 2,0.',
        profiles: [{ id: 'p_martin', name: 'Martín Ortiz', phone: '11 3344-5566', avg: 2.0, records: { adoption_request: 2 }, lastRecordAt: '2026-04-18' }],
        person: { fullName: 'Valeria Castro', phone: '11 3344-5566' },
        activity: { activityType: 'adoption_request' },
        why: 'El teléfono es de un perfil con otro nombre → `ambiguous` (`name_mismatch`): nunca adivinamos que son la misma persona. La actividad va a un perfil nuevo que un admin revisa como posible duplicado. `risk` igual te muestra el 2★ de ese teléfono.',
    },
    {
        key: 'multiple_profiles',
        title: 'Dos perfiles con el mismo nombre y email',
        registered: 'Dos perfiles «Laura Díaz» con el email laura.diaz@example.com: uno con el teléfono 11 2233-4455, calificado 3,0 y marcado como duplicado; el otro sin calificar.',
        profiles: [
            { id: 'p_laura_a', name: 'Laura Díaz', email: 'laura.diaz@example.com', phone: '11 2233-4455', avg: 3.0, flags: ['duplicate'], records: { adoption: 1 }, lastRecordAt: '2025-11-30' },
            { id: 'p_laura_b', name: 'Laura Díaz', email: 'laura.diaz@example.com', avg: null, records: { adoption_request: 1 }, lastRecordAt: '2026-02-11' },
        ],
        person: { fullName: 'Laura Díaz', email: 'laura.diaz@example.com', phone: '11 2233-4455' },
        activity: { activityType: 'adoption_request' },
        why: 'El nombre encaja con los dos perfiles → `ambiguous` (`multiple_profiles`). La actividad va al que mejor coincide: el que tiene email **y** teléfono iguales (`p_laura_a`); no se crea un perfil nuevo.',
    },
    {
        key: 'dry_run',
        title: 'Prueba sin guardar (X-Dry-Run: 1, solo staging)',
        registered: 'Nadie registró ese email (en staging).',
        profiles: [],
        person: { fullName: 'Sofía Medina', email: 'sofia.medina@example.com' },
        activity: { activityType: 'adoption_request' },
        dryRun: true,
        why: 'La misma respuesta que una llamada real, pero **sin `activity`**: no se guardó nada. En producción este header se rechaza (`403 dry_run_not_allowed`).',
    },
];

const NOT_RISK = new Set(['verified_identity', 'verified_address']);

function matchedOn(req: ScenarioDef['person'], p: Registered): Identifier[] {
    const sent: Partial<Record<Identifier, string>> = { email: req.email, phone: req.phone, documentId: req.documentId?.value };
    return IDENTIFIERS.filter(k => sent[k] && p[k] && keyOf[k](sent[k]!) === keyOf[k](p[k]!));
}

/** Work out the answer the API gives, from the registered profiles and the request. */
function answer(def: ScenarioDef, origin: string, n: number) {
    const url = (id: string) => `${origin}/adopter/${id}`;
    const hits = def.profiles.filter(p => matchedOn(def.person, p).length > 0);
    const outcome = decideExactOutcome(def.person.fullName, hits.map(p => ({ profileId: p.id, name: p.name, aliases: [], householdNames: [] })));
    const byId = new Map(hits.map(p => [p.id, p]));
    const summary = (p: Registered) => ({
        profileId: p.id, url: url(p.id), ...ratingOf(p.avg),
        flags: p.flags ?? [], tooManyRequests: p.tooManyRequests ?? null, tooManyAdoptions: p.tooManyAdoptions ?? null,
        records: p.records, lastRecordAt: p.lastRecordAt,
    });
    const worst = (ps: Registered[]) => {
        const rated = ps.map(p => p.avg).filter((a): a is number => a !== null);
        return ratingOf(rated.length ? Math.min(...rated) : null);
    };
    const flags = new Set<string>();
    for (const p of hits) {
        for (const f of p.flags ?? []) if (!NOT_RISK.has(f)) flags.add(f);
        if (p.tooManyRequests) flags.add('too_many_requests');
        if (p.tooManyAdoptions) flags.add('too_many_adoptions');
    }
    const body: Record<string, unknown> = {
        requestId: `b1d0c8e2-0000-4000-8000-${String(n).padStart(12, '0')}`, mode: 'exact', result: outcome.result,
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
        if (others.length) body.otherMatches = { count: others.length, urls: others.map(o => url(o.id)), worstRating: worst(others) };
        savedOn = { id: p.id, created: false, contactsAdded: added(p) };
    } else if (outcome.result === 'ambiguous') {
        const cands = outcome.profileIds.map(id => byId.get(id)!);
        Object.assign(body, { reason: outcome.reason, candidates: cands.length, candidateUrls: cands.map(c => url(c.id)), worstRating: worst(cands) });
        // Best match (pickBestMatch's first criterion: most identifiers matched); no name fits → a new profile.
        const fitting = outcome.compatible.map(c => byId.get(c.profileId)!)
            .sort((a, b) => matchedOn(def.person, b).length - matchedOn(def.person, a).length);
        savedOn = fitting.length ? { id: fitting[0].id, created: false, contactsAdded: added(fitting[0]) } : { id: `p_new_${def.key}`, created: true, contactsAdded: [] };
    } else {
        savedOn = { id: `p_new_${def.key}`, created: true, contactsAdded: [] };
    }
    body.risk = { worstRating: worst(hits), flags: [...flags].sort(), profilesMatched: hits.length };
    if (def.activity && !def.dryRun && savedOn) {
        const rid = `r_${def.key}`;
        body.activity = {
            activityId: rid, activityUrl: `${url(savedOn.id)}?record=${rid}`, profileId: savedOn.id, profileUrl: url(savedOn.id),
            profileCreated: savedOn.created, contactsAdded: savedOn.contactsAdded,
        };
    }
    return body;
}

export interface Scenario {
    key: string; title: string; registered: string; why: string; dryRun: boolean;
    request: Record<string, unknown>;
    response: Record<string, unknown>;
}

export function exactScenarios(origin: string): Scenario[] {
    return DEFS.map((d, i) => ({
        key: d.key, title: d.title, registered: d.registered, why: d.why, dryRun: !!d.dryRun,
        request: { mode: 'exact', person: d.person, ...(d.activity ? { activity: d.activity } : {}) },
        response: answer(d, origin, i + 1),
    }));
}
