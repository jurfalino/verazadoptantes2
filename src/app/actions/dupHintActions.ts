'use server';

/**
 * «Ya está en otro perfil» → the «Ver perfil» window's answers (Jon
 * 2026-10-29, prototype proto-shots/dato-coincide-v3.html). The window only
 * renders what getDuplicateHintMatches decided; these actions decide again
 * from the session and the database (never the client's `action`), through
 * the same reader (src/lib/dupHintFacts.ts) and rule (decideDupHintAction):
 *
 * - `continueWithMatchedProfile` — case 1, «Continuar con este perfil» →
 *   «Sí, continuar»: the profile being edited (CURRENT) folds into the one in
 *   the window (MATCH, the survivor), with the shared merge, access and
 *   notices of «Pendientes» (mergeChosenPair, src/lib/pairMerge.ts). The value
 *   being typed is saved first on CURRENT through the normal contact add
 *   (addContactEntry), so the merge carries it to MATCH and nothing typed is lost.
 * - `askAdminsToReviewPair` — case 4, «Ya dijeron que no son la misma
 *   persona»: files the dispute exactly as «Pendientes»' 'dispute' choice does
 *   (createMergeRequest with `ownerEmail: null, dispute: true`, MATCH kept).
 *
 * Browser-callable: the session is the only source of the actor. Refusals
 * come back as codes with an errorId (the window says «No se pudo unir los
 * perfiles (error …)»); failures are logged with their context.
 */
import { getDb, getUser } from './_db';
import { addContactEntry } from './addContactEntry';
import { logger, generateErrorId } from '@/lib/logger';
import { isRealActorEmail } from '@/lib/piiAccess';
import { normEmail } from '@/lib/orgMembership';
import { createMergeRequest } from '@/lib/mergeRequests';
import { mergeChosenPair } from '@/lib/pairMerge';
import { decideDupHintMatch, loadDupHintViewer, profileRow } from '@/lib/dupHintFacts';
import { dupHintMergePlan, isDupHintType, typedIsNewFor, DUP_HINT_MAX_VALUE } from '@/domain/dupHint';
import { CONTACT_ENTRIES_FULL, deserializeContactEntries, detectSocialPlatform, parseBlobToContactEntries, type MessagingApp, type SocialPlatform } from '@/lib/contactEntries';

const id64 = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 64) : '');

async function sessionActor(): Promise<string | null> {
    let actor = '';
    try { actor = await getUser(); } catch { /* anonymous: refused below */ }
    return isRealActorEmail(actor) ? actor : null;
}

const SOCIAL_PLATFORMS: readonly string[] = ['facebook', 'instagram', 'tiktok', 'x', 'threads', 'other'];
const MESSAGING_APPS: readonly string[] = ['whatsapp', 'telegram'];

export type ContinueWithMatchedProfileResult =
    | { ok: true; matchId: string; currentName: string; told: string[] }
    /** `typedSaved`: the typed value was saved on the profile being edited before the merge failed — the composer clears it. */
    | { ok: false; error: string; errorId: string; typedSaved?: true };

export async function continueWithMatchedProfile(input: {
    currentId: string;
    matchId: string;
    typed?: { type: string; value: string; platform?: string; apps?: string[] };
}): Promise<ContinueWithMatchedProfileResult> {
    const currentId = id64(input?.currentId);
    const matchId = id64(input?.matchId);
    let actor: string | null = null;
    const ctx: Record<string, unknown> = { currentId, matchId, actor: null };
    const refuse = (error: string) => {
        const errorId = generateErrorId();
        logger.warn('continueWithMatchedProfile: refused', { ...ctx, reason: error, errorId });
        return { ok: false as const, error, errorId };
    };
    try {
        actor = await sessionActor();
        ctx.actor = actor;
        if (!actor) return refuse('unauthenticated');
        if (!currentId || !matchId || currentId === matchId) return refuse('invalid');
        const db = await getDb();
        if (!db) throw new Error('No database');

        const [viewer, match] = await Promise.all([loadDupHintViewer(db, actor, currentId), profileRow(db, matchId)]);
        const current = viewer.current;
        if (!current || !match || match.deletedAt) return refuse('not_found');
        const decision = await decideDupHintMatch(db, { ...viewer, current }, { id: match.id, addedBy: match.addedBy });
        // Cases 2–5 are someone else's call (or already someone's): never merged from here.
        if (decision.action !== 'continue') return refuse(`not_allowed:${decision.action}`);
        const plan = dupHintMergePlan({
            actor, isAdmin: viewer.isAdmin,
            currentTeamOwned: viewer.currentTeamOwned, matchTeamOwned: decision.matchTeamOwned,
            currentAddedBy: current.addedBy, matchAddedBy: match.addedBy,
        });

        // The value being typed: saved on CURRENT as its Save would, so the merge
        // carries it to MATCH — and nothing typed is lost. Not when MATCH already
        // has it as the matcher compares it (typedIsNewFor: «+54 9 11 6312-0851»
        // is «11 6312-0851»): the merge would keep both copies.
        const typed = input?.typed;
        const matchParsed = deserializeContactEntries(match.contactEntries);
        const matchEntries = matchParsed.length > 0 ? matchParsed : parseBlobToContactEntries(match.contactInfo);
        let typedSaved = false;
        if (typed && isDupHintType(typed.type) && typeof typed.value === 'string' && typed.value.trim()
            && typedIsNewFor(matchEntries, typed.type, typed.value.trim())) {
            const platform = typed.type === 'social' && typeof typed.platform === 'string' && SOCIAL_PLATFORMS.includes(typed.platform)
                ? typed.platform as SocialPlatform : undefined;
            // A handle needs its network, as the composer's Save asks for it.
            if (typed.type === 'social' && !detectSocialPlatform(typed.value) && !platform) return refuse('platform_required');
            const apps = typed.type === 'phone' && Array.isArray(typed.apps)
                ? typed.apps.filter((a): a is MessagingApp => typeof a === 'string' && MESSAGING_APPS.includes(a)) : [];
            const added = await addContactEntry({
                adopterId: current.id, type: typed.type, value: typed.value.trim().slice(0, DUP_HINT_MAX_VALUE),
                ...(platform ? { platform } : {}), ...(apps.length ? { apps } : {}),
            });
            if (!added.ok) {
                if (added.error === CONTACT_ENTRIES_FULL) return refuse(CONTACT_ENTRIES_FULL);
                const errorId = 'errorId' in added && typeof added.errorId === 'string' ? added.errorId : generateErrorId();
                logger.warn('continueWithMatchedProfile: the typed value was not saved, nothing merged', { ...ctx, type: typed.type, reason: added.error, errorId });
                return { ok: false, error: 'typed_not_saved', errorId };
            }
            typedSaved = true;
        }

        const merged = await mergeChosenPair(db, {
            primaryId: match.id, secondaryId: current.id, actor,
            isAdmin: viewer.isAdmin, viaAdmin: plan.viaAdmin, notifyOwner: plan.notifyOwner,
            absorbedAddedBy: current.addedBy,
            label: 'continueWithMatchedProfile', ctx,
        });
        if (!merged.ok) {
            const failed = merged.error === 'merge_failed' ? { ok: false as const, error: 'merge_failed', errorId: merged.errorId } : refuse(merged.error);
            return typedSaved ? { ...failed, typedSaved: true } : failed;
        }

        let told: string[] = [];
        if (plan.told.length > 0) {
            const { resolveDisplayNames } = await import('./notifications');
            const names = await resolveDisplayNames(plan.told).catch((e: unknown) => {
                logger.warn('continueWithMatchedProfile: told names lookup failed, naming the handles', { ...ctx, error: e instanceof Error ? e.message : String(e) });
                return new Map<string, string>();
            });
            told = plan.told.map(e => names.get(normEmail(e)) ?? e.split('@')[0]);
        }
        logger.info('continueWithMatchedProfile: continued', { ...ctx, viaAdmin: plan.viaAdmin, told: plan.told.length, wasPending: decision.alreadyPending });
        return { ok: true, matchId: match.id, currentName: merged.result.secondaryName ?? current.name ?? '', told };
    } catch (e) {
        const errorId = logger.error('continueWithMatchedProfile failed', e, ctx);
        return { ok: false, error: 'failed', errorId };
    }
}

export type AskAdminsToReviewPairResult =
    | { ok: true; already: boolean }
    | { ok: false; error: string; errorId: string };

export async function askAdminsToReviewPair(input: { currentId: string; matchId: string }): Promise<AskAdminsToReviewPairResult> {
    const currentId = id64(input?.currentId);
    const matchId = id64(input?.matchId);
    const ctx: Record<string, unknown> = { currentId, matchId, actor: null };
    const refuse = (error: string) => {
        const errorId = generateErrorId();
        logger.warn('askAdminsToReviewPair: refused', { ...ctx, reason: error, errorId });
        return { ok: false as const, error, errorId };
    };
    try {
        const actor = await sessionActor();
        ctx.actor = actor;
        if (!actor) return refuse('unauthenticated');
        if (!currentId || !matchId || currentId === matchId) return refuse('invalid');
        const db = await getDb();
        if (!db) throw new Error('No database');
        const [viewer, match] = await Promise.all([loadDupHintViewer(db, actor, currentId), profileRow(db, matchId)]);
        const current = viewer.current;
        if (!current || !match || match.deletedAt) return refuse('not_found');
        const decision = await decideDupHintMatch(db, { ...viewer, current }, { id: match.id, addedBy: match.addedBy });
        if (decision.action !== 'review_admins') return refuse(`not_allowed:${decision.action}`);
        // As «Pendientes»' 'dispute' (D49/D50): the admins decide, MATCH kept.
        const filed = await createMergeRequest(db, {
            primaryId: match.id, secondaryId: current.id,
            candidateId: null, flagId: decision.flagId,
            requesterEmail: actor, ownerEmail: null, dispute: true,
        });
        if ('refused' in filed) return refuse(filed.refused);
        // Already pending (ours, or someone else's on the same pair): it is being reviewed — nothing new sent.
        const already = !filed.created;
        logger.info('askAdminsToReviewPair: filed', { ...ctx, requestId: filed.id, created: filed.created, ours: normEmail(filed.requesterEmail) === normEmail(actor) });
        return { ok: true, already };
    } catch (e) {
        const errorId = logger.error('askAdminsToReviewPair failed', e, ctx);
        return { ok: false, error: 'failed', errorId };
    }
}
