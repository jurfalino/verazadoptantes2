/**
 * Shared rows for the evaluation-action tests (applications.access.test.ts,
 * applications.test.ts). Test-only: never import from app code.
 *
 * OWNER and MATE share a team (src/test-utils/actionMocks.ts); STRANGER is
 * outside it. Luna is OWNER's available cat; Sol is STRANGER's dog.
 *   app-s-luna — Ana's form for Luna, through OWNER's link (on profile «ana»).
 *   app-s-gen  — Beto's general form (no animal), through OWNER's link (on «beto»), «Prefiere» dog.
 */
import { OWNER, STRANGER } from '@/test-utils/actionMocks';

type Row = Record<string, unknown>;
export type Sqlite = {
    prepare: (s: string) => { get: (...a: unknown[]) => Row | undefined; run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Row[] };
};

export const NOW = Math.floor(Date.now() / 1000);
export const DAY = 86_400;

/**
 * migratedDb is the SYNC better-sqlite3 driver; D1 returns promises (the reads chain .catch on them).
 * Not `values`: on an insert it is the builder step, not the raw-rows read.
 */
export function asyncDb<T extends object>(target: T): T {
    return new Proxy(target, {
        get(t, p, r) {
            const v = Reflect.get(t, p, r);
            if (typeof v !== 'function') return v;
            return (...args: unknown[]) => {
                const out = (v as (...a: unknown[]) => unknown).apply(t, args);
                if (p === 'get' || p === 'all' || p === 'run') return Promise.resolve(out);
                return out && typeof out === 'object' && p !== 'then' ? asyncDb(out as object) : out;
            };
        },
    });
}

export function adopter(sqlite: Sqlite, id: string, name: string, addedBy: string, extra: { contactInfo?: string; contactEntries?: string; isPublic?: number } = {}) {
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, contact_info, contact_entries, is_public, created_at, updated_at) VALUES (?, ?, '5', ?, ?, ?, ?, 1000, 1000)`)
        .run(id, name, addedBy, extra.contactInfo ?? null, extra.contactEntries ?? null, extra.isPublic ?? 0);
}

export function animal(sqlite: Sqlite, id: string, name: string, addedBy: string, o: { species?: string; sex?: string; birthSec?: number | null } = {}) {
    sqlite.prepare(`INSERT INTO animals (id, name, species, sex, estimated_birth_date, added_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1000, 1000)`)
        .run(id, name, o.species ?? 'cat', o.sex ?? 'hembra', o.birthSec ?? null, addedBy);
}

export function placement(sqlite: Sqlite, id: string, animalId: string, adopterId: string, recordType: 'foster' | 'adoption') {
    sqlite.prepare(`INSERT INTO placements (id, animal_id, adopter_id, record_type, started_at, created_at) VALUES (?, ?, ?, ?, 1000, 1000)`)
        .run(id, animalId, adopterId, recordType);
}

export function form(sqlite: Sqlite, id: string, o: {
    owner?: string; name?: string; adopter?: string | null; auto?: string | null; animal?: string | null;
    email?: string | null; phone?: string | null; species?: string | null; lifeStage?: string | null; createdAt?: number;
} = {}) {
    const adopterId = o.adopter === undefined ? null : o.adopter;
    sqlite.prepare(`INSERT INTO form_submissions (id, user_id, name, email, phone, species, life_stage, selected_animal_id, linked_adopter_id, auto_adopter_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, o.owner ?? OWNER, o.name ?? id, o.email ?? null, o.phone ?? null, o.species ?? null, o.lifeStage ?? null,
            o.animal ?? null, adopterId, o.auto === undefined ? adopterId : o.auto, o.createdAt ?? NOW - DAY);
}

export function application(sqlite: Sqlite, id: string, submissionId: string, animalId: string | null, o: { origin?: string; state?: string; closeReason?: string | null; offerDoneAt?: number | null } = {}) {
    sqlite.prepare(`INSERT INTO applications (id, submission_id, animal_id, origin, state, close_reason, offer_done_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, submissionId, animalId, o.origin ?? 'form', o.state ?? 'open', o.closeReason ?? null, o.offerDoneAt ?? null, NOW - DAY);
}

export function invitation(sqlite: Sqlite, token: string, animalId: string, adopterId: string, expiresAt: number | null, usedAt: number | null = null) {
    sqlite.prepare(`INSERT INTO contract_invitations (token, animal_id, adopter_id, created_by, created_at, expires_at, used_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(token, animalId, adopterId, OWNER, NOW - DAY, expiresAt, usedAt);
}

/** The base world both test files start from. */
export function seedEvaluation(sqlite: Sqlite) {
    adopter(sqlite, 'ana', 'Ana Pérez', OWNER);
    adopter(sqlite, 'beto', 'Beto Gómez', OWNER);
    animal(sqlite, 'luna', 'Luna', OWNER, { species: 'cat', sex: 'hembra' });
    animal(sqlite, 'sol', 'Sol', STRANGER, { species: 'dog', sex: 'macho' });
    form(sqlite, 's-luna', { name: 'Ana Pérez', adopter: 'ana', animal: 'luna', email: 'ana@example.com', phone: '11 5555-0101' });
    application(sqlite, 'app-s-luna', 's-luna', 'luna');
    form(sqlite, 's-gen', { name: 'Beto Gómez', adopter: 'beto', species: 'dog', lifeStage: 'none' });
    application(sqlite, 'app-s-gen', 's-gen', null);
}

/** Every table an evaluation action may write, as rows — «nothing written» compares two of these. */
export function snapshot(sqlite: Sqlite) {
    const t = (sql: string) => sqlite.prepare(sql).all();
    return {
        applications: t('SELECT * FROM applications ORDER BY id'),
        events: t('SELECT * FROM adopter_events ORDER BY id'),
        history: t('SELECT * FROM adopter_history ORDER BY id'),
        invitations: t('SELECT * FROM contract_invitations ORDER BY token'),
        notifications: t('SELECT * FROM notifications ORDER BY id'),
    };
}

/** A bell notice about a form (`metadata.submissionId`), unread — the owner's and each teammate's copy look alike. */
export function formNotice(sqlite: Sqlite, id: string, userId: string, submissionId: string, type = 'form_submission') {
    sqlite.prepare(`INSERT INTO notifications (id, user_id, type, title, body, url, read, metadata, created_at) VALUES (?, ?, ?, 't', 'b', ?, 0, ?, ?)`)
        .run(id, userId, type, `/my-animals?view=solicitudes&solicitud=app-${submissionId}`, JSON.stringify({ submissionId }), NOW - DAY);
}

/** The ids of the unread notices, sorted. */
export function unreadNotices(sqlite: Sqlite): string[] {
    return (sqlite.prepare('SELECT id FROM notifications WHERE read = 0 ORDER BY id').all() as Array<{ id: string }>).map(r => r.id);
}
