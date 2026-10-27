'use server';

/**
 * A profile's name and age — open to anyone signed in (households as profiles,
 * Task 3 — Jon, 2026-10-27). Thin doors: the session gives the actor, the
 * writes and notices live in src/lib/profileIdentity.ts.
 *
 * What a stranger can do here (action-surface sign-off):
 * - `changeProfileName`: rename ANY live profile (at most RENAME_RATE_LIMIT an
 *   hour per person; a teammate's notices of one person's renames of one
 *   profile collapse within an hour). Safeguards: the old name
 *   stays a name token («Conocido/a como»), the write is a compare-and-set on
 *   the name the editor saw, the change is credited ('contribution' history
 *   for a stranger, never 'edit' — no approver standing), and the owner's team
 *   is told in-app and by email with «Deshacer» (a change by the owner's own
 *   team is not news to it: no notice, as D54).
 * - `changeProfileAge`: set the age / «Es menor de edad» of any live profile;
 *   credited, notified. Marking a profile with records or alerts as a minor
 *   is refused (it would hide the «¿Qué pasó con …?» actions on an adult).
 * - `undoProfileRename` / `getRenameUndoOption`: only the owner's team, an
 *   admin or a moderator; anyone else gets `not_authorized` and no names.
 */
import { revalidatePath } from 'next/cache';
import { getDb, getUser } from './_db';
import { logger } from '@/lib/logger';
import { isRealActorEmail } from '@/lib/piiAccess';
import { adopterFieldAuthors } from '@/lib/collabAttribution';
import { isPrivilegedOnProfile } from '@/lib/profilePrivilege';
import {
    notifyProfileAgeChanged, notifyProfileRenamed, renameProfile, renamesBySince, renameUndoState, setProfileAge, undoRename,
} from '@/lib/profileIdentity';
import { isValidAge, MAX_PROFILE_NAME_LEN, RENAME_RATE_LIMIT, RENAME_RATE_WINDOW_MS } from '@/domain/profileIdentity';
import { canonField } from '@/domain/fieldCollab';

export type ProfileIdentityError =
    | 'not_authenticated' | 'not_found' | 'invalid' | 'conflict' | 'busy' | 'failed'
    | 'has_activity' | 'not_authorized' | 'not_undoable' | 'already_undone' | 'superseded'
    /** Final fix S5: this person made RENAME_RATE_LIMIT renames within the last hour. */
    | 'rate_limited';

type Fail = { ok: false; error: ProfileIdentityError; errorId?: string };

/** Another inline field a teammate changed since this tab loaded it (the form shows «Actualizado por …»). */
export type ProfileFieldUpdate = { field: 'familyMembers' | 'status'; by: string; value: string | null };

export type ChangeProfileNameResult =
    | { ok: true; name: string; aliasKept: boolean; warningErrorId?: string; updatedByOthers?: ProfileFieldUpdate[] }
    /** `conflict`: the stored name (`theirs`) and who wrote it (`by`, a display name or '') — «alguien cambió este dato mientras lo editabas». */
    | { ok: false; error: 'conflict'; theirs: string; by: string }
    | { ok: false; error: Exclude<ProfileIdentityError, 'conflict'>; errorId?: string };

export type ChangeProfileAgeResult = { ok: true; age: number | null; isMinor: boolean; warningErrorId?: string } | Fail;
export type UndoProfileRenameResult = { ok: true; name: string; warningErrorId?: string } | Fail;
export type RenameUndoOption =
    | { status: 'can_undo'; adopterId: string; from: string; to: string }
    | { status: 'not_found' | 'not_undoable' | 'not_authorized' | 'already_undone' | 'superseded' | 'failed' };

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const id64 = (v: unknown) => (typeof v === 'string' && v.trim().length > 0 && v.length <= 64 ? v.trim() : '');

async function sessionActor(op: string): Promise<string | null> {
    let actor = '';
    try {
        actor = await getUser();
    } catch (e) {
        logger.info(`${op}: no session — refused`, { error: errMsg(e) });
    }
    return isRealActorEmail(actor) ? actor : null;
}

export async function changeProfileName(input: {
    adopterId: string; name: string; expectedName: string | null;
    /** What the form loaded for its OTHER inline fields: those a teammate changed since come back in `updatedByOthers`. */
    loaded?: { familyMembers?: string | null; status?: string | null };
}): Promise<ChangeProfileNameResult> {
    const actor = await sessionActor('changeProfileName');
    if (!actor) return { ok: false, error: 'not_authenticated' };
    const adopterId = id64(input?.adopterId);
    const name = typeof input?.name === 'string' ? input.name.trim() : '';
    const expected = input?.expectedName;
    if (!adopterId || !name || name.length > MAX_PROFILE_NAME_LEN
        || (expected !== null && (typeof expected !== 'string' || expected.length > 1000))) {
        return { ok: false, error: 'invalid' };
    }
    const ctx = { adopterId, actor };
    try {
        const db = await getDb();
        if (!db) throw new Error('No database');
        // Final fix S5: a per-person ceiling, so nobody can flood a team with rename notices.
        if (await renamesBySince(db, actor, new Date(Date.now() - RENAME_RATE_WINDOW_MS)) >= RENAME_RATE_LIMIT) {
            logger.warn('changeProfileName: refused — rename rate limit reached', { ...ctx, limit: RENAME_RATE_LIMIT });
            return { ok: false, error: 'rate_limited' };
        }
        const res = await renameProfile(db, { adopterId, name, expectedName: expected, actor });
        switch (res.status) {
            case 'missing': return { ok: false, error: 'not_found' };
            case 'busy': return { ok: false, error: 'busy', errorId: res.errorId };
            case 'unchanged': return { ok: true, name, aliasKept: false };
            case 'conflict': {
                const by = (await adopterFieldAuthors(db, adopterId, ['name'])).name ?? '';
                return { ok: false, error: 'conflict', theirs: res.theirs, by };
            }
            case 'renamed': {
                await notifyProfileRenamed(db, { adopterId, actor, ownerEmail: res.ownerEmail, from: res.from, to: res.to, historyId: res.historyId });
                revalidatePath(`/adopter/${adopterId}`);
                // Only someone who may see the whole row hears what else changed (family text is masked for others).
                const updatedByOthers = (await isPrivilegedOnProfile(actor, res.ownerEmail))
                    ? await othersChanged(db, adopterId, input?.loaded, res.others)
                    : [];
                return {
                    ok: true, name: res.to, aliasKept: res.aliasKept,
                    ...(updatedByOthers.length ? { updatedByOthers } : {}),
                    ...(res.warningErrorId ? { warningErrorId: res.warningErrorId } : {}),
                };
            }
        }
    } catch (e) {
        const errorId = logger.error('changeProfileName failed', e, ctx);
        return { ok: false, error: 'failed', errorId };
    }
}

async function othersChanged(
    db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
    adopterId: string,
    loaded: { familyMembers?: string | null; status?: string | null } | undefined,
    stored: { familyMembers: string | null; status: string | null },
): Promise<ProfileFieldUpdate[]> {
    if (!loaded || typeof loaded !== 'object') return [];
    const fields = (['familyMembers', 'status'] as const).filter(f =>
        f in loaded && (loaded[f] === null || typeof loaded[f] === 'string') && canonField(f, loaded[f]) !== canonField(f, stored[f]));
    if (!fields.length) return [];
    const by = await adopterFieldAuthors(db, adopterId, [...fields]);
    return fields.map(f => ({ field: f, by: by[f] ?? '', value: stored[f] }));
}

export async function changeProfileAge(input: { adopterId: string; age: number | null; isMinor: boolean }): Promise<ChangeProfileAgeResult> {
    const actor = await sessionActor('changeProfileAge');
    if (!actor) return { ok: false, error: 'not_authenticated' };
    const adopterId = id64(input?.adopterId);
    const age = input?.age === null ? null : input?.age;
    if (!adopterId || (age !== null && !isValidAge(age)) || typeof input?.isMinor !== 'boolean') return { ok: false, error: 'invalid' };
    const ctx = { adopterId, actor };
    try {
        const db = await getDb();
        if (!db) throw new Error('No database');
        const res = await setProfileAge(db, { adopterId, age, isMinor: input.isMinor, actor });
        switch (res.status) {
            case 'missing': return { ok: false, error: 'not_found' };
            case 'busy': return { ok: false, error: 'busy', errorId: res.errorId };
            case 'has_activity': return { ok: false, error: 'has_activity' };
            case 'unchanged': return { ok: true, age, isMinor: age !== null ? age < 18 : input.isMinor };
            case 'changed':
                await notifyProfileAgeChanged(db, { adopterId, actor, ownerEmail: res.ownerEmail, name: res.name, age: res.to.age, minor: res.to.minor });
                revalidatePath(`/adopter/${adopterId}`);
                return { ok: true, age: res.to.age, isMinor: res.to.minor, ...(res.warningErrorId ? { warningErrorId: res.warningErrorId } : {}) };
        }
    } catch (e) {
        const errorId = logger.error('changeProfileAge failed', e, ctx);
        return { ok: false, error: 'failed', errorId };
    }
}

export async function undoProfileRename(historyId: string): Promise<UndoProfileRenameResult> {
    const actor = await sessionActor('undoProfileRename');
    if (!actor) return { ok: false, error: 'not_authenticated' };
    const id = id64(historyId);
    if (!id) return { ok: false, error: 'invalid' };
    const ctx = { historyId: id, actor };
    try {
        const db = await getDb();
        if (!db) throw new Error('No database');
        const res = await undoRename(db, id, actor);
        if (res.status === 'undone') {
            revalidatePath(`/adopter/${res.adopterId}`);
            return { ok: true, name: res.restored, ...(res.warningErrorId ? { warningErrorId: res.warningErrorId } : {}) };
        }
        if (res.status === 'busy') return { ok: false, error: 'busy', errorId: res.errorId };
        logger.info('undoProfileRename: refused', { ...ctx, status: res.status });
        return { ok: false, error: res.status };
    } catch (e) {
        const errorId = logger.error('undoProfileRename failed', e, ctx);
        return { ok: false, error: 'failed', errorId };
    }
}

/** For the «¿Deshacer el cambio de nombre?» prompt (the email link): may this viewer undo it, and what would change. */
export async function getRenameUndoOption(historyId: string): Promise<RenameUndoOption> {
    const actor = await sessionActor('getRenameUndoOption');
    const id = id64(historyId);
    if (!actor || !id) return { status: 'not_authorized' };
    try {
        const db = await getDb();
        if (!db) throw new Error('No database');
        const state = await renameUndoState(db, id, actor);
        if (state.status === 'can_undo') return { status: 'can_undo', adopterId: state.adopterId, from: state.from, to: state.to };
        return { status: state.status };
    } catch (e) {
        logger.error('getRenameUndoOption failed', e, { historyId: id, actor });
        return { status: 'failed' };
    }
}
