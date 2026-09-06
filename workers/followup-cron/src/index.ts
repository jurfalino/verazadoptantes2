/**
 * Follow-up reminder cron (v2.55.17, animal-timeline PR4).
 *
 * Daily scheduled Worker on the app's D1: computes the DUE follow-up slots per
 * active placement with the SAME pure domain code the app uses, and inserts
 * `follow_up_due` rows into `notifications` (the in-app bell). Double-gated
 * (ENABLE_FOLLOWUPS + the NOTIF_ENABLED_follow_up_due kill switch) and
 * double-deduped (due-only statuses + a per-(placement, slot) dedupKey lookup).
 *
 * IMPORTANT: only PURE modules may be imported from the main app
 * (src/domain/*, nothing from src/app, src/db or 'use server' files) — the
 * import-graph is enforced by src/domain/followups.test.ts living beside the
 * shared code and by review; wrangler bundles the relative import.
 *
 * Raw SQL throughout (epoch SECONDS, like the app's Drizzle timestamp mode);
 * no IN(?) array expansion beyond fixed literals (D1 quirk).
 */

import {
    computeFollowups, mergeSchedule, mergeFosterRule, parseFollowupSettings,
    DEFAULT_SCHEDULE, type FollowupSettings, type RecordedFollowup,
} from '../../../src/domain/followups';
import { dedupKey, notificationTitle, notificationBody } from './copy';

interface Env {
    DB: D1Database;
}

/** Adoption candidates are bounded (180d slot + window + margin); FOSTERS ARE
 *  NOT — a long-lived transit still gets its monthly check-in. */
const ADOPTION_SCAN_DAYS = 400;
const CHUNK = 20;

type PlacementRow = {
    id: string; animal_id: string; adopter_id: string; record_type: string;
    started_at: number; added_by: string; name: string | null;
    estimated_birth_date: number | null; neutered: number | null;
    adopter_name: string | null;
};

export default {
    async scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
        const summary = { scanned: 0, due: 0, notified: 0, deduped: 0, skippedOwners: 0, errors: 0 };
        try {
            // ── gates: mirror createNotification's kill switch + the feature flag ──
            const flags = await env.DB.prepare(
                `SELECT key, value FROM app_config WHERE key IN ('ENABLE_FOLLOWUPS', 'NOTIF_ENABLED_follow_up_due')`
            ).all<{ key: string; value: string }>();
            const flagMap = new Map((flags.results || []).map(r => [r.key, r.value]));
            if (flagMap.get('ENABLE_FOLLOWUPS') !== 'true') {
                console.log(JSON.stringify({ op: 'followup-cron', skipped: 'ENABLE_FOLLOWUPS off' }));
                return;
            }
            if (flagMap.get('NOTIF_ENABLED_follow_up_due') === 'false') {
                console.log(JSON.stringify({ op: 'followup-cron', skipped: 'kill switch' }));
                return;
            }

            // ── candidates: active placements of non-deleted animals ──
            const candidates = await env.DB.prepare(
                `SELECT p.id, p.animal_id, p.adopter_id, p.record_type, p.started_at,
                        a.added_by, a.name, a.estimated_birth_date, a.neutered,
                        ad.name AS adopter_name
                 FROM placements p
                 JOIN animals a ON a.id = p.animal_id
                 LEFT JOIN adopters ad ON ad.id = p.adopter_id
                 WHERE p.ended_at IS NULL
                   AND a.deleted_at IS NULL
                   AND p.started_at IS NOT NULL
                   AND (p.record_type = 'foster'
                        OR (p.record_type = 'adoption' AND p.started_at > strftime('%s','now') - ${ADOPTION_SCAN_DAYS} * 86400))`
            ).all<PlacementRow>();
            const rows = (candidates.results || []).filter(r => {
                if (!r.added_by || !r.added_by.includes('@')) { summary.skippedOwners++; return false; } // 'anonymous' legacy
                return true;
            });
            summary.scanned = rows.length;

            // ── per-owner settings, fetched once (user_profiles keys on user id) ──
            const owners = Array.from(new Set(rows.map(r => r.added_by)));
            const settingsByOwner = new Map<string, FollowupSettings | null>();
            for (const email of owners) {
                try {
                    const row = await env.DB.prepare(
                        `SELECT up.followup_settings AS s FROM user_profiles up JOIN user u ON u.id = up.user_id WHERE u.email = ? LIMIT 1`
                    ).bind(email).first<{ s: string | null }>();
                    settingsByOwner.set(email, parseFollowupSettings(row?.s));
                } catch (e) {
                    console.log(JSON.stringify({ op: 'followup-cron', warn: 'settings fallback', email, error: String(e) }));
                    settingsByOwner.set(email, null);
                }
            }

            const now = new Date();
            for (let i = 0; i < rows.length; i += CHUNK) {
                const chunk = rows.slice(i, i + CHUNK);
                await Promise.all(chunk.map(async (p) => {
                    try {
                        const settings = settingsByOwner.get(p.added_by) ?? null;
                        const [events, careEvents] = await Promise.all([
                            env.DB.prepare(
                                `SELECT id, date, followup_key, followup_subtype, event_type, placement_id
                                 FROM adopter_events WHERE animal_id = ?`
                            ).bind(p.animal_id).all<{ id: string; date: number | null; followup_key: string | null; followup_subtype: string | null; event_type: string; placement_id: string | null }>(),
                            env.DB.prepare(
                                `SELECT id, date, followup_key, event_type FROM animal_events WHERE animal_id = ?`
                            ).bind(p.animal_id).all<{ id: string; date: number | null; followup_key: string | null; event_type: string }>(),
                        ]);
                        const asDate = (v: number | null): Date | null => (typeof v === 'number' ? new Date(v * 1000) : null);
                        const recorded: RecordedFollowup[] = [
                            ...(events.results || [])
                                .filter(e => e.placement_id === p.id || !e.placement_id)
                                .map(e => ({ id: e.id, date: asDate(e.date), followupKey: e.followup_key, subtype: e.followup_subtype, eventType: e.event_type })),
                            ...(careEvents.results || [])
                                .map(e => ({ id: e.id, date: asDate(e.date), followupKey: e.followup_key, subtype: null, eventType: e.event_type })),
                        ];

                        const slots = computeFollowups({
                            placementStartedAt: new Date(p.started_at * 1000),
                            placementType: p.record_type,
                            animal: { estimatedBirthDate: asDate(p.estimated_birth_date), neutered: p.neutered },
                            schedule: mergeSchedule(DEFAULT_SCHEDULE, settings),
                            fosterRule: mergeFosterRule(settings),
                            recorded,
                            now,
                        }).filter(s => s.status === 'due'); // NEVER missed — storm guard #1
                        summary.due += slots.length;

                        for (const s of slots) {
                            const key = dedupKey(p.id, s.key);
                            // Dedup layer 2: one notification per (placement, slot), ever.
                            const existing = await env.DB.prepare(
                                `SELECT 1 AS x FROM notifications
                                 WHERE type = 'follow_up_due' AND user_id = ?
                                   AND json_extract(metadata, '$.dedupKey') = ? LIMIT 1`
                            ).bind(p.added_by, key).first();
                            if (existing) { summary.deduped++; continue; }

                            await env.DB.prepare(
                                `INSERT INTO notifications (id, user_id, type, title, body, url, icon, read, dismissed, metadata, created_at, expires_at)
                                 VALUES (?, ?, 'follow_up_due', ?, ?, ?, '🔔', 0, 0, ?, strftime('%s','now'), ?)`
                            ).bind(
                                crypto.randomUUID(),
                                p.added_by,
                                notificationTitle(p.name),
                                notificationBody(s, p.adopter_name, p.record_type === 'foster'),
                                `/my-animals/${p.animal_id}#next-action`,
                                JSON.stringify({ dedupKey: key, placementId: p.id, animalId: p.animal_id, followupKey: s.key }),
                                Math.floor(s.windowEndsAt.getTime() / 1000),
                            ).run();
                            summary.notified++;
                        }
                    } catch (e) {
                        summary.errors++;
                        console.log(JSON.stringify({ op: 'followup-cron', warn: 'placement fallback', placementId: p.id, animalId: p.animal_id, owner: p.added_by, error: String(e) }));
                    }
                }));
            }
        } catch (e) {
            summary.errors++;
            console.log(JSON.stringify({ op: 'followup-cron', error: String(e) }));
        } finally {
            console.log(JSON.stringify({ op: 'followup-cron', ...summary }));
        }
    },
};
