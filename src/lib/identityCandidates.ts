/**
 * Candidate retrieval for the identity verdict (spec 2026-11-02-identity-verdict-design §2).
 * Reuses the duplicate engine (token index + LIKE fallback) but keeps same-name
 * candidates that share no identifier, then reads what each one shares and how many
 * differently-named live profiles hold it, so the pure verdict can decide.
 *
 * D1 budget per call: 1 engine call + <= limit detail reads + <= MAX_COUNT_QUERIES name-count
 * queries, the last two in parallel. The engine is asked for ENGINE_POOL results (its limit
 * only slices its final list — no extra queries) so profiles sharing an identifier come
 * before same-name ones; the pool is cut to `limit` before any read here.
 * Never logs names, contacts or token values — ids and counts only.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { adopters, duplicateTokens } from '@/db/schema';
import { logger } from '@/lib/logger';
import { deserializeContactEntries } from '@/lib/contactEntries';
import { findAdopters } from '@/app/actions/findAdopters';
import type { DuplicateMatch } from '@/app/actions/types';
import type { getDb } from '@/lib/db';
import {
    judgeIdentity, rankJudged,
    type IdentifierKind, type IdentityCandidate, type Judged, type PersonFacts, type SharedIdentifier,
} from '@/domain/identityVerdict';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

const DEFAULT_LIMIT = 5;
/** How many engine results are ranked before cutting to the caller's limit. */
const ENGINE_POOL = 20;
/** Token types that mean "shares an identifier" (never a name or a LIKE fallback). */
const IDENTIFIER_TOKEN_TYPES = new Set(['phone', 'phone_suffix', 'email', 'social', 'social_handle', 'id_number']);
const MAX_COUNT_QUERIES = 12;
const NAMES_SAMPLE = 10;

const foldName = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');

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

interface SharedToken { kind: IdentifierKind; value: string; tokenType: string; tokenValue: string }

/** What a candidate shares with the input, one entry per identifier. Name and like_fallback_* matches never count. */
function sharedTokens(matchValues: Array<{ type: string; value: string }>): SharedToken[] {
    const out: SharedToken[] = [];
    const seen = new Set<string>();
    const push = (t: SharedToken) => {
        const key = `${t.kind}|${t.value}`;
        if (!seen.has(key)) { seen.add(key); out.push(t); }
    };
    const has = (type: string) => matchValues.some(v => v.type === type);
    for (const v of matchValues) {
        if (v.type === 'phone') push({ kind: 'phone', value: v.value, tokenType: 'phone', tokenValue: v.value });
        else if (v.type === 'phone_suffix' && !has('phone')) push({ kind: 'phone', value: v.value, tokenType: 'phone_suffix', tokenValue: v.value });
        else if (v.type === 'email') push({ kind: 'email', value: v.value, tokenType: 'email', tokenValue: v.value });
        else if (v.type === 'id_number') push({ kind: 'document', value: v.value, tokenType: 'id_number', tokenValue: v.value });
        else if (v.type === 'social' || v.type === 'social_handle') {
            const handle = v.type === 'social' ? v.value.slice(v.value.indexOf('|') + 1) : v.value;
            // one per handle; count by the handle token when it fired, else by the platform|handle token
            const handleFired = matchValues.some(m => m.type === 'social_handle' && m.value === handle);
            if (v.type === 'social' && handleFired) continue;
            push({ kind: 'social', value: handle, tokenType: v.type, tokenValue: v.value });
        }
    }
    return out;
}

export async function findIdentityCandidates(db: Db, facts: PersonFacts, ctx: Record<string, unknown>, opts: { limit?: number } = {}): Promise<IdentityCandidate[]> {
    const limit = opts.limit ?? DEFAULT_LIMIT;
    const res = await findAdopters(
        {
            name: facts.name, aliases: facts.aliases, phones: facts.phones, emails: facts.emails,
            socials: facts.socials, ids: facts.documentIds, country: facts.country ?? undefined,
        },
        { mode: 'duplicate', keepNameOnly: true, minRelevance: 5, limit: ENGINE_POOL },
    );
    // Profiles that share an identifier first (engine order kept within each tier), so
    // many same-name profiles can't push the one holding the DNI or email out of the list.
    const pool = res.results as DuplicateMatch[];
    const sharesIdentifier = (m: DuplicateMatch) => m.matchValues.some(v => IDENTIFIER_TOKEN_TYPES.has(v.type));
    const matches = [...pool.filter(sharesIdentifier), ...pool.filter(m => !sharesIdentifier(m))].slice(0, limit);

    // One detail read per candidate (name + aliases).
    const details = await Promise.all(matches.map(m =>
        db.select({ name: adopters.name, contactEntries: adopters.contactEntries }).from(adopters)
            .where(and(eq(adopters.id, m.adopterId), isNull(adopters.deletedAt))).limit(1)
            .then((rows: Array<{ name: string; contactEntries: string | null }>) => rows[0] ?? null)
            .catch((e: unknown) => {
                logger.warn('identityCandidates: D1 fallback hit (details)', { ...ctx, adopterId: m.adopterId, ...redactedErrorFields(e) });
                return undefined;
            }),
    ));

    const sharedPer = matches.map(m => sharedTokens(m.matchValues));

    // Distinct (tokenType, tokenValue) across candidates, bounded.
    const keyOf = (t: SharedToken) => `${t.tokenType}|${t.tokenValue}`;
    const distinct = new Map<string, SharedToken>();
    for (const list of sharedPer) for (const t of list) if (!distinct.has(keyOf(t))) distinct.set(keyOf(t), t);
    const probes = Array.from(distinct.values()).slice(0, MAX_COUNT_QUERIES);
    if (distinct.size > probes.length) {
        logger.warn('identityCandidates: name-count budget exceeded', { ...ctx, wanted: distinct.size, kept: probes.length });
    }
    const counts = new Map<string, number | null>();
    await Promise.all(probes.map(async t => {
        const k = keyOf(t);
        try {
            const rows: Array<{ name: string }> = await db.select({ name: adopters.name }).from(duplicateTokens)
                .innerJoin(adopters, eq(adopters.id, duplicateTokens.adopterId))
                .where(and(eq(duplicateTokens.tokenType, t.tokenType), eq(duplicateTokens.tokenValue, t.tokenValue), isNull(adopters.deletedAt)))
                .limit(NAMES_SAMPLE);
            counts.set(k, new Set(rows.map(r => foldName(r.name))).size);
        } catch (e) {
            logger.warn('identityCandidates: D1 fallback hit (name count)', { ...ctx, tokenType: t.tokenType, ...redactedErrorFields(e) });
            counts.set(k, null);
        }
    }));

    return matches.map((m, i): IdentityCandidate => {
        const d = details[i];
        const entries = d ? deserializeContactEntries(d.contactEntries) : [];
        const shared: SharedIdentifier[] = sharedPer[i].map(t => ({
            kind: t.kind, value: t.value, namesHolding: counts.get(keyOf(t)) ?? null,
        }));
        return {
            adopterId: m.adopterId,
            name: d?.name ?? m.adopterName,
            aliases: entries.filter(e => e.type === 'alias').map(e => e.value),
            shared,
            relevancePercent: m.relevancePercent,
            matchTypes: m.matchTypes,
            matchValues: m.matchValues,
            source: m.source,
            ...(d ? {} : { degraded: true }),
        };
    });
}

export async function judgeCandidates(db: Db, facts: PersonFacts, ctx: Record<string, unknown>, opts: { limit?: number } = {}): Promise<Judged[]> {
    const candidates = await findIdentityCandidates(db, facts, ctx, opts);
    return rankJudged(candidates.map(c => judgeIdentity(facts, c)));
}
