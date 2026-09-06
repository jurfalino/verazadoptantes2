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
import { dedupKey, notificationTitle, notificationBody, buildFollowupEmail, type FollowupEmailItem } from './copy';

interface Env {
    DB: D1Database;
    /** Deep-link base for notification/email URLs (wrangler [vars]). */
    APP_BASE_URL?: string;
    /** Optional overrides; app_config rows RESEND_API_KEY / EMAIL_FROM are the
     *  fallback (same env-first-then-appConfig convention as emailOtp.ts). */
    RESEND_API_KEY?: string;
    EMAIL_FROM?: string;
}

/** Adoption candidates are bounded (180d slot + window + margin); FOSTERS ARE
 *  NOT — a long-lived transit still gets its monthly check-in.
 *
 *  ⚠️ This bound must always exceed the LONGEST schedulable slot + its window,
 *  or placements would be skipped SILENTLY. `assertScanBoundCovers()` below
 *  logs loudly if a schedule (default or user-customized) ever outgrows it —
 *  e.g. if someone adds a 1-year check-in. */
const ADOPTION_SCAN_DAYS = 400;

function assertScanBoundCovers(schedule: { offsetDays?: number; windowDays: number }[]): void {
    const longest = schedule.reduce((max, e) => Math.max(max, (e.offsetDays ?? 0) + e.windowDays), 0);
    if (longest > ADOPTION_SCAN_DAYS) {
        console.log(JSON.stringify({
            op: 'followup-cron', warn: 'SCAN BOUND TOO SMALL — older placements are being skipped',
            longestSlotDays: longest, scanBoundDays: ADOPTION_SCAN_DAYS,
        }));
    }
}
const CHUNK = 20;

type PlacementRow = {
    id: string; animal_id: string; adopter_id: string; record_type: string;
    started_at: number; added_by: string; name: string | null;
    estimated_birth_date: number | null; neutered: number | null;
    adopter_name: string | null;
};

export default {
    async scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
        const summary = { scanned: 0, due: 0, notified: 0, deduped: 0, emailed: 0, emailedItems: 0, emailFailed: 0, skippedOwners: 0, errors: 0 };
        try {
            // ── gates: mirror createNotification's kill switch + the feature flag ──
            // (+ email config, env-first then app_config — the emailOtp convention)
            const flags = await env.DB.prepare(
                `SELECT key, value FROM app_config WHERE key IN ('ENABLE_FOLLOWUPS', 'NOTIF_ENABLED_follow_up_due', 'RESEND_API_KEY', 'EMAIL_FROM')`
            ).all<{ key: string; value: string }>();
            const flagMap = new Map((flags.results || []).map(r => [r.key, r.value]));
            const resendKey = env.RESEND_API_KEY || flagMap.get('RESEND_API_KEY') || '';
            const emailFrom = env.EMAIL_FROM || flagMap.get('EMAIL_FROM') || 'noreply@buenadoptante.org';
            const baseUrl = (env.APP_BASE_URL || 'https://buenadoptante.org').replace(/\/$/, '');
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

            // ── team recipients per owner, then settings for EVERY email involved ──
            // The OWNER's schedule decides the slots; the whole org receives the
            // reminder (v2.55.18), each member deduped on their own — and each
            // RECIPIENT's own settings decide their email opt-in (v2.55.19).
            const owners = Array.from(new Set(rows.map(r => r.added_by)));
            const recipientsByOwner = new Map<string, string[]>();
            for (const email of owners) {
                try {
                    const mates = await env.DB.prepare(
                        `SELECT DISTINCT m2.user_email AS e
                         FROM org_members m1 JOIN org_members m2 ON m2.org_id = m1.org_id
                         WHERE m1.user_email = ?`
                    ).bind(email).all<{ e: string }>();
                    const set = new Set<string>([email]);
                    for (const m of mates.results || []) if (m.e && m.e.includes('@')) set.add(m.e);
                    recipientsByOwner.set(email, [...set].slice(0, 30));
                } catch (e) {
                    console.log(JSON.stringify({ op: 'followup-cron', warn: 'team fallback (owner only)', email, error: String(e) }));
                    recipientsByOwner.set(email, [email]);
                }
            }
            const everyEmail = Array.from(new Set([...owners, ...[...recipientsByOwner.values()].flat()]));
            const settingsByEmail = new Map<string, FollowupSettings | null>();
            for (const email of everyEmail) {
                try {
                    const row = await env.DB.prepare(
                        `SELECT up.followup_settings AS s FROM user_profiles up JOIN user u ON u.id = up.user_id WHERE u.email = ? LIMIT 1`
                    ).bind(email).first<{ s: string | null }>();
                    settingsByEmail.set(email, parseFollowupSettings(row?.s));
                } catch (e) {
                    console.log(JSON.stringify({ op: 'followup-cron', warn: 'settings fallback', email, error: String(e) }));
                    settingsByEmail.set(email, null);
                }
            }

            // v2.55.21: email is DIGESTED — one message per recipient per run,
            // however many reminders fired. Bells stay per-slot (each is
            // individually actionable); only the mailbox gets batched. Items are
            // queued ONLY for slots that actually inserted a notification, so
            // the digest inherits the same once-ever dedup.
            const emailQueue = new Map<string, FollowupEmailItem[]>();

            const now = new Date();
            for (let i = 0; i < rows.length; i += CHUNK) {
                const chunk = rows.slice(i, i + CHUNK);
                await Promise.all(chunk.map(async (p) => {
                    try {
                        const settings = settingsByEmail.get(p.added_by) ?? null;
                        if (p.record_type === 'adoption') assertScanBoundCovers(mergeSchedule(DEFAULT_SCHEDULE, settings));
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

                        // v2.55.20: a member who chose «solo los animales que
                        // cargué yo» is dropped from OTHER people's animals
                        // (the owner always keeps their own). Visibility is
                        // unaffected — this is purely about being pinged.
                        const recipients = (recipientsByOwner.get(p.added_by) ?? [p.added_by])
                            .filter(r => r === p.added_by || settingsByEmail.get(r)?.onlyMyAnimals !== true);
                        for (const s of slots) {
                            for (const recipient of recipients) {
                                const key = dedupKey(p.id, s.key, recipient);
                                // Dedup layer 2: one notification per (placement, slot, recipient), ever.
                                const existing = await env.DB.prepare(
                                    `SELECT 1 AS x FROM notifications
                                     WHERE type = 'follow_up_due' AND user_id = ?
                                       AND json_extract(metadata, '$.dedupKey') = ? LIMIT 1`
                                ).bind(recipient, key).first();
                                if (existing) { summary.deduped++; continue; }

                                await env.DB.prepare(
                                    `INSERT INTO notifications (id, user_id, type, title, body, url, icon, read, dismissed, metadata, created_at, expires_at)
                                     VALUES (?, ?, 'follow_up_due', ?, ?, ?, '🔔', 0, 0, ?, strftime('%s','now'), ?)`
                                ).bind(
                                    crypto.randomUUID(),
                                    recipient,
                                    notificationTitle(p.name),
                                    notificationBody(s, p.adopter_name, p.record_type === 'foster'),
                                    `/my-animals/${p.animal_id}#next-action`,
                                    JSON.stringify({ dedupKey: key, placementId: p.id, animalId: p.animal_id, followupKey: s.key }),
                                    Math.floor(s.windowEndsAt.getTime() / 1000),
                                ).run();
                                summary.notified++;

                                // v2.55.19/21: opt-in email — the RECIPIENT's own setting
                                // decides. Queued here (inside the post-insert branch) so
                                // the digest covers exactly the slots that were newly
                                // notified, then sent once per recipient after the scan.
                                if (resendKey && settingsByEmail.get(recipient)?.emailReminders === true) {
                                    const queue = emailQueue.get(recipient) || [];
                                    queue.push({
                                        animalName: p.name,
                                        body: notificationBody(s, p.adopter_name, p.record_type === 'foster'),
                                        url: `${baseUrl}/my-animals/${p.animal_id}#next-action`,
                                    });
                                    emailQueue.set(recipient, queue);
                                }
                            }
                        }
                    } catch (e) {
                        summary.errors++;
                        console.log(JSON.stringify({ op: 'followup-cron', warn: 'placement fallback', placementId: p.id, animalId: p.animal_id, owner: p.added_by, error: String(e) }));
                    }
                }));
            }
            // ── one digest email per recipient (same template, N items) ──
            for (const [recipient, queueItems] of emailQueue) {
                if (queueItems.length === 0) continue;
                try {
                    const mail = buildFollowupEmail(queueItems, `${baseUrl}/my-animals`);
                    const res = await fetch('https://api.resend.com/emails', {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ from: emailFrom, to: recipient, subject: mail.subject, html: mail.html, text: mail.text }),
                    });
                    if (res.ok) { summary.emailed++; summary.emailedItems += queueItems.length; }
                    else {
                        summary.emailFailed++;
                        const apiError = await res.text().catch(() => '');
                        console.log(JSON.stringify({ op: 'followup-cron', warn: 'email send rejected', status: res.status, apiError: apiError.slice(0, 200), items: queueItems.length }));
                    }
                } catch (e) {
                    summary.emailFailed++;
                    console.log(JSON.stringify({ op: 'followup-cron', warn: 'email send threw', items: queueItems.length, error: String(e) }));
                }
            }

            // ── retention: prune this cron's own expired notifications ──
            // v2.55.20: `notifications` had no cleanup path, and team fan-out
            // multiplies growth by team size. Only OUR type is touched, and only
            // rows whose actionable window closed 90+ days ago — the dedup keys
            // they carry are moot by then (the slot is long 'missed', which the
            // Worker never notifies). Best-effort: a failure never fails the run.
            try {
                const pruned = await env.DB.prepare(
                    `DELETE FROM notifications
                     WHERE type = 'follow_up_due'
                       AND expires_at IS NOT NULL
                       AND expires_at < strftime('%s','now') - 90 * 86400`
                ).run();
                const n = pruned.meta?.changes ?? 0;
                if (n > 0) console.log(JSON.stringify({ op: 'followup-cron', pruned: n }));
            } catch (e) {
                console.log(JSON.stringify({ op: 'followup-cron', warn: 'retention prune failed', error: String(e) }));
            }
        } catch (e) {
            summary.errors++;
            console.log(JSON.stringify({ op: 'followup-cron', error: String(e) }));
        } finally {
            console.log(JSON.stringify({ op: 'followup-cron', ...summary }));
        }
    },
};
