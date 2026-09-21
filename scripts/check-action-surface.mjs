#!/usr/bin/env node
/**
 * A ratchet on the browser-callable surface.
 *
 * Every export of a `'use server'` module becomes a POST endpoint, and Next
 * records one id per export in the compiled server-reference manifest. That
 * manifest maps ids to the routes that serve them and carries no source path,
 * so the only thing it can tell us is HOW MANY doors exist. That turns out to
 * be the useful question: the number should change only when someone means it.
 *
 * `src/app/actions/notifications.ts` going back on the wire moves it from 148
 * to 161 in one step, because all thirteen of its exports become endpoints —
 * the write side takes the recipient, title, body and link as arguments and
 * checks none of them, and the read side pages through any named user's bell,
 * which carries adopter name, phone, address and DNI in `metadata`. Measured,
 * not assumed: both numbers came from building it each way.
 *
 * Unlike `src/lib/serverActionSurface.test.ts`, this does not care how the
 * directive is written or where it sits, and it also notices a NEW action that
 * wraps a trusted helper under a different name — the one shape no source scan
 * can distinguish from an ordinary action that happens to notify someone.
 *
 * Adding a server action on purpose means raising EXPECTED_ACTIONS in the same
 * commit. That is the point, not an inconvenience: it makes every new door a
 * decision someone signed off on.
 *
 * Run after `npm run build`.
 */
import { readFileSync } from 'node:fs';

const MANIFEST = '.next/server/server-reference-manifest.json';
const EXPECTED_ACTIONS = 148;

let manifest;
try {
    manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
} catch (e) {
    console.error(`::error::cannot read ${MANIFEST} — run \`npm run build\` first (${e.message})`);
    process.exit(1);
}

const total = ['node', 'edge'].reduce((n, scope) => n + Object.keys(manifest[scope] || {}).length, 0);

if (total === 0) {
    console.error('::error::the manifest lists no server actions at all — the build looks wrong, not clean');
    process.exit(1);
}

if (total !== EXPECTED_ACTIONS) {
    const verb = total > EXPECTED_ACTIONS ? 'gained' : 'lost';
    console.error(`::error::the browser-callable surface ${verb} ${Math.abs(total - EXPECTED_ACTIONS)} endpoint(s): ${EXPECTED_ACTIONS} expected, ${total} built.`);
    console.error('If that was deliberate, raise EXPECTED_ACTIONS in scripts/check-action-surface.mjs in the same commit,');
    console.error('having checked that each new export is safe to call with arguments a stranger chooses.');
    console.error('If it was not, something became a server action that should not be one — see src/lib/serverActionSurface.test.ts.');
    process.exit(1);
}

console.log(`server-action surface OK: ${total} browser-callable endpoints, as expected`);
