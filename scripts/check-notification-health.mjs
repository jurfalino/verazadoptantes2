#!/usr/bin/env node
/**
 * Does the notification machinery still work in production?
 *
 * Between May and 2026-09-19 it did not, and nobody noticed for four months,
 * because a thing that does not happen produces no error — only silence. The
 * fix in 2.56.70 added log lines saying "this ran", but a log line is a record,
 * not a signal: it needs a human to go and look, which is exactly what failed.
 *
 * This asks the database the one question that matters. Adding a contact detail
 * to a record somebody ELSE owns must notify that owner. So: count the
 * contributions in the window that have no matching notification. That number
 * must be zero. When it is not, the run fails, and a failing scheduled workflow
 * reaches a person.
 *
 * It deliberately does NOT fail when nothing happened. A quiet week is not a
 * fault, and an alarm that cries wolf gets muted, which is how we get back to
 * four months of silence. It says so in the output instead.
 *
 *   node scripts/check-notification-health.mjs [--days N] [--db NAME]
 */
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
    options: {
        days: { type: 'string', default: '7' },
        db: { type: 'string', default: 'pet-adoption-db' },
        // Override the floor below, so this check can be proven to fail when it
        // should: `--since 0` replays the history it was built from.
        since: { type: 'string' },
    },
});
const WINDOW_DAYS = Number(values.days);
const WINDOW = WINDOW_DAYS * 86400;

/**
 * The fix went live at 2026-09-20 02:00 UTC. Contributions before that were
 * genuinely not notified and are not evidence of anything being wrong now, so
 * they are excluded — otherwise this would fail every day for a week over
 * history nobody can change, and an alarm that is always red is no alarm.
 */
const FIX_DEPLOYED_AT = values.since === undefined ? 1789869600 : Number(values.since);

if (!Number.isFinite(WINDOW_DAYS) || WINDOW_DAYS <= 0) {
    console.error(`::error::--days must be a positive number, got ${values.days}`);
    process.exit(1);
}

const q = (sql) => {
    const out = execFileSync('npx', [
        'wrangler', 'd1', 'execute', values.db, '--remote', '--json', '--command', sql,
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 << 20 });
    return JSON.parse(out.slice(out.indexOf('[')))[0].results;
};

/**
 * Contributions to someone else's record that produced no notification for the
 * owner. The owner must look like a real address — imported records carry
 * placeholders that nobody can be notified at — and the actor must not be the
 * owner, because notifying yourself is correctly skipped.
 */
const UNMATCHED = `
    SELECT a.target AS adopter_id, a.created_at
    FROM audit_log a
    JOIN adopters ad ON ad.id = a.target
    WHERE a.action = 'contact_entry_added'
      AND a.created_at > strftime('%s','now') - ${WINDOW}
      AND a.created_at > ${FIX_DEPLOYED_AT}
      AND ad.added_by <> a.user_email
      AND ad.added_by LIKE '%@%'
      AND NOT EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.type = 'contact_entry_added'
          AND n.user_id = ad.added_by
          AND n.metadata LIKE '%' || a.target || '%'
          AND n.created_at BETWEEN a.created_at - 300 AND a.created_at + 900
      )
    ORDER BY a.created_at DESC
    LIMIT 20`;

const COUNTS = `
    SELECT
      (SELECT COUNT(*) FROM audit_log
        WHERE action = 'contact_entry_added'
          AND created_at > strftime('%s','now') - ${WINDOW}
          AND created_at > ${FIX_DEPLOYED_AT})                                     AS contributions,
      (SELECT COUNT(*) FROM notifications
        WHERE created_at > strftime('%s','now') - ${WINDOW}
          AND created_at > ${FIX_DEPLOYED_AT})                                     AS notifications,
      (SELECT COUNT(*) FROM pii_access_requests
        WHERE created_at > strftime('%s','now') - ${WINDOW}
          AND created_at > ${FIX_DEPLOYED_AT})                                     AS access_requests`;

let unmatched, counts;
try {
    unmatched = q(UNMATCHED);
    [counts] = q(COUNTS);
} catch (e) {
    console.error(`::error::could not query ${values.db}: ${e.message}`);
    process.exit(1);
}

console.log(`Window: last ${WINDOW_DAYS} day(s) of ${values.db}, from the fix at ${new Date(FIX_DEPLOYED_AT * 1000).toISOString()}`);
console.log(`  contributions logged      ${counts.contributions}`);
console.log(`  notifications created     ${counts.notifications}`);
console.log(`  access requests filed     ${counts.access_requests}`);

if (unmatched.length > 0) {
    console.error('');
    console.error(`::error::${unmatched.length} contribution(s) to someone else's record notified nobody.`);
    console.error('The owner-notification path is not completing in production — the same failure');
    console.error('that went unnoticed from May to 2026-09-19. Check that background work is still');
    console.error('handed to runAfterResponse (src/lib/background.ts) and look for');
    console.error('"addContactEntry: approvers notified" in Axiom.');
    for (const row of unmatched) {
        console.error(`  adopter ${row.adopter_id} at ${new Date(row.created_at * 1000).toISOString()}`);
    }
    process.exit(1);
}

if (counts.contributions === 0) {
    console.log('');
    console.log(`No contribution to anyone else's record in ${WINDOW_DAYS} day(s), so this proves nothing yet.`);
    console.log('Not a failure: a quiet week is not a fault, and an alarm that cries wolf gets muted.');
    console.log('To settle it deliberately, add a contact detail to a record you own and look for');
    console.log('"addContactEntry: approvers notified" with recipients: 0 in Axiom.');
    process.exit(0);
}

console.log('');
console.log(`OK: every contribution in the window notified its record's owner.`);
