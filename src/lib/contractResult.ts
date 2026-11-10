/**
 * H1: one contract result, opened by EITHER id (server-only).
 *
 *   - a NOTICE id (old links, emails, the bell): read from the notice, as
 *     before; today's rule (recipient, their team, admins). Never falls
 *     through to the signed-contract lookup on a denial.
 *   - a SIGNED-CONTRACT id (the record's «Datos y posibles duplicados»):
 *     read from signed_contracts, so the result survives the notice being
 *     deleted; the signed PDF's rule (the animal's current rescue, admins).
 *
 * The page (/contract-results/[id]) and attachContractToExistingAdopter both
 * resolve through here, so they can never disagree. A D1 failure THROWS — the
 * caller logs it with an errorId. One exception, the same as the PDF route: on
 * the signed path a failed org_members read (loadOrgMembership, logged at warn)
 * leaves only the owner and admins in, so a teammate then gets the 404.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { adopters, animals, notifications, placements, signedContracts } from '@/db/schema';
import { isAdminAsyncStrict } from '@/config/admins';
import { isOrgMateStrict } from '@/lib/orgMembership';
import { loadOrgMembership, sameRescueDirect } from '@/lib/rescueKeys';
import { canViewerAccessContractResult, canViewerAccessSignedContract, CONTRACT_RESULT_TYPE } from '@/lib/contractResultAccess';
import { logger } from '@/lib/logger';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = any;

export interface ContractSubmittedData {
    name: string;
    phone: string;
    email: string;
    dni: string;
    address: string;
    socialNetworks: string;
}

export interface ContractResultView {
    kind: 'notice' | 'signed';
    /** The id the result was opened with. */
    id: string;
    notificationId: string | null;
    signedContractId: string | null;
    animalId: string | null;
    animalName: string;
    /** The profile the signature landed on (the open path's new profile). */
    adopterId: string | null;
    adopterName: string;
    matchCount: number;
    submittedData: ContractSubmittedData | null;
}

export type ContractResultLookup =
    | { status: 'found'; view: ContractResultView }
    | { status: 'not_found' }
    | { status: 'denied' }
    /** A notice the viewer may open that is not a contract result. */
    | { status: 'not_contract' };

const str = (v: unknown) => (typeof v === 'string' ? v : '');

function asSubmitted(v: unknown): ContractSubmittedData | null {
    if (!v || typeof v !== 'object') return null;
    const o = v as Record<string, unknown>;
    return { name: str(o.name), phone: str(o.phone), email: str(o.email), dni: str(o.dni), address: str(o.address), socialNetworks: str(o.socialNetworks) };
}

function parseJson(raw: string | null | undefined, op: string, ctx: Record<string, unknown>): any {
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) {
        logger.warn(`${op}: stored JSON unreadable, shown without it`, { ...ctx, error: e instanceof Error ? e.message : String(e) });
        return null;
    }
}

export async function loadContractResult(db: Db, id: string, viewer: string): Promise<ContractResultLookup> {
    const notice = await db.select().from(notifications).where(eq(notifications.id, id)).get();
    if (notice) {
        if (!(await canViewerAccessContractResult(viewer, notice, { isOrgMate: isOrgMateStrict, isAdmin: isAdminAsyncStrict }))) return { status: 'denied' };
        if (notice.type !== CONTRACT_RESULT_TYPE) return { status: 'not_contract' };
        const m = parseJson(notice.metadata, 'contractResult(notice)', { notificationId: id, viewer }) ?? {};
        return {
            status: 'found',
            view: {
                kind: 'notice', id, notificationId: id,
                signedContractId: str(m.signedContractId) || null,
                animalId: str(m.animalId) || null,
                animalName: str(m.animalName),
                adopterId: str(m.adopterId) || null,
                adopterName: str(m.adopterName),
                matchCount: typeof m.matchCount === 'number' ? m.matchCount : 0,
                submittedData: asSubmitted(m.submittedData),
            },
        };
    }

    const sc = await db.select({
        id: signedContracts.id, animalId: signedContracts.animalId, adopterId: signedContracts.adopterId,
        submittedJson: signedContracts.submittedJson, matchCount: signedContracts.matchCount,
    }).from(signedContracts).where(eq(signedContracts.id, id)).get();
    if (!sc) return { status: 'not_found' };
    // A deleted animal: the same answer as the PDF (nothing to open).
    const animal = await db.select({ addedBy: animals.addedBy, name: animals.name }).from(animals)
        .where(and(eq(animals.id, sc.animalId), isNull(animals.deletedAt))).get();
    if (!animal) return { status: 'not_found' };
    let membership: Map<string, string[]> | null = null;
    const allowed = await canViewerAccessSignedContract(viewer, animal.addedBy, {
        sameRescue: async (v, o) => {
            if (v === o) return true;
            membership ??= await loadOrgMembership(db, 'contractResult');
            return sameRescueDirect(v, o, membership);
        },
        isAdmin: isAdminAsyncStrict,
    });
    if (!allowed) return { status: 'denied' };
    const submitted = asSubmitted(parseJson(sc.submittedJson, 'contractResult(signed)', { signedContractId: id, viewer }));
    // A signature from before H1 (no stored data): at least the profile's name.
    let adopterName = submitted?.name ?? '';
    if (!adopterName && sc.adopterId) {
        adopterName = (await db.select({ name: adopters.name }).from(adopters).where(eq(adopters.id, sc.adopterId)).get())?.name ?? '';
    }
    return {
        status: 'found',
        view: {
            kind: 'signed', id, notificationId: null, signedContractId: sc.id,
            animalId: sc.animalId,
            animalName: animal.name ?? '',
            adopterId: sc.adopterId ?? null,
            adopterName,
            matchCount: sc.matchCount ?? 0,
            submittedData: submitted,
        },
    };
}

/**
 * The names the back link may show (`?from=adopter:<id> | animal:<id>`,
 * formBackLink): only a profile that holds this animal's placement (the
 * record it was opened from, also after a merge) or the signing profile, and
 * only this animal. Anything else stays unnamed, so the link goes to the
 * default. Never throws: a failed lookup logs and leaves the name out.
 */
export async function contractBackNames(db: Db, view: ContractResultView, from: string | null, ctx: Record<string, unknown>): Promise<{ adopter?: string | null; animal?: string | null }> {
    const out: { adopter?: string | null; animal?: string | null } = {};
    const [kind, fromId] = (from ?? '').split(':', 2);
    if (!fromId) return out;
    try {
        if (kind === 'adopter') {
            const holds = fromId === view.adopterId || (!!view.animalId && !!(await db.select({ id: placements.id }).from(placements)
                .where(and(eq(placements.animalId, view.animalId), eq(placements.adopterId, fromId))).get()));
            if (holds) out.adopter = (await db.select({ name: adopters.name }).from(adopters).where(and(eq(adopters.id, fromId), isNull(adopters.deletedAt))).get())?.name ?? null;
        } else if (kind === 'animal' && fromId === view.animalId) {
            out.animal = (await db.select({ name: animals.name }).from(animals).where(eq(animals.id, fromId)).get())?.name ?? null;
        }
    } catch (e) {
        logger.warn('contract-results: back-link name lookup failed, back to the default', { ...ctx, from, error: e instanceof Error ? e.message : String(e) });
    }
    return out;
}
