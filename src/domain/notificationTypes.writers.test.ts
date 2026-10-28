/**
 * Every notification type the app WRITES is in NOTIFICATION_TYPES (audit fix
 * round 2, item 3): the bell and /notificaciones label and draw a type from that
 * list (NotificationTypeIcon.test checks each has an es/en/pt label and an icon),
 * so a writer whose type is missing there shows a raw key and a generic bell —
 * as `adopter_login_blocked` (blockedLoginRecorder) did.
 *
 * The scan reads the writers' source: the `type:` of every createNotification /
 * notifyAdmins / notifyOrgMembers / notifyApprovers call and raw
 * `insert(notifications)`, the positional type of the household and identity
 * notice helpers (`send` / `sendTo`), createNotification's default, and the
 * follow-up cron Worker's SQL insert.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NOTIFICATION_TYPES } from './constants';

const ROOT = path.resolve(__dirname, '../..');

function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
            out.push(...sourceFiles(full));
        } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
            out.push(full);
        }
    }
    return out;
}

/** The text of the call whose `(` is at `open`, skipping strings and comments. */
function callText(src: string, open: number): string {
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        const c = src[i];
        if (c === '"' || c === "'" || c === '`') {
            for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
            continue;
        }
        if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
        if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 1; continue; }
        if (c === '(' || c === '{' || c === '[') depth++;
        else if (c === ')' || c === '}' || c === ']') { depth--; if (depth === 0) return src.slice(open, i + 1); }
    }
    return src.slice(open);
}

/** String literals in the `type:` expression at the call's top-level object (not a nested `metadata: { type }`). */
function topLevelTypeLiterals(call: string): string[] {
    const found: string[] = [];
    let depth = 0;
    for (let i = 0; i < call.length; i++) {
        const c = call[i];
        if (c === '"' || c === "'" || c === '`') {
            for (i++; i < call.length && call[i] !== c; i++) if (call[i] === '\\') i++;
            continue;
        }
        if (c === '(' || c === '{' || c === '[') { depth++; continue; }
        if (c === ')' || c === '}' || c === ']') { depth--; continue; }
        // depth 2 = inside `({ … })` (or `.values({ … })`): the notification's own fields.
        if (depth === 2 && /[\s,{]/.test(call[i - 1] ?? '') && call.startsWith('type', i) && /^type\s*:/.test(call.slice(i))) {
            const rest = call.slice(i).replace(/^type\s*:\s*/, '');
            const expr = rest.slice(0, rest.search(/,\s*\n|,\s*[a-zA-Z.]+\s*[:,]|\s*\}/) >>> 0);
            // The values the expression can take (`a === 'x' ? 'type_a' : 'type_b'`), not what it compares.
            for (const m of expr.replace(/[=!]==?\s*'[a-z_]+'/g, '').matchAll(/'([a-z_]+)'/g)) found.push(m[1]);
        }
    }
    return found;
}

function writtenTypes(): { types: Set<string>; sites: number } {
    const types = new Set<string>();
    let sites = 0;
    const files = [...sourceFiles(path.join(ROOT, 'src')), ...sourceFiles(path.join(ROOT, 'workers'))];
    for (const file of files) {
        const src = fs.readFileSync(file, 'utf8');
        for (const m of src.matchAll(/\b(?:createNotification|notifyAdmins|notifyOrgMembers|notifyApprovers)\s*\(|\.insert\(\s*notifications\s*\)\s*\.values\s*\(/g)) {
            if (/function\s+$/.test(src.slice(Math.max(0, m.index - 20), m.index))) continue; // the declaration itself
            const open = m.index + m[0].length - 1;
            const lits = topLevelTypeLiterals(callText(src, open));
            sites++;
            lits.forEach(t => types.add(t));
        }
        // A notification built first and passed on (`const notification = { type: 'api_record', … }`).
        for (const m of src.matchAll(/\bnotification\s*=\s*\{/g)) {
            topLevelTypeLiterals(`(${callText(src, m.index + m[0].length - 1)})`).forEach(t => types.add(t));
            sites++;
        }
        for (const m of src.matchAll(/\b(?:send|sendTo)\(\s*[A-Za-z_.[\]()', ]+?,\s*'([a-z_]+)'/g)) { types.add(m[1]); sites++; }
        for (const m of src.matchAll(/data\.type\s*\|\|\s*'([a-z_]+)'/g)) types.add(m[1]);
        for (const m of src.matchAll(/INSERT INTO notifications\s*\([^)]*\)\s*VALUES\s*\(\s*\?,\s*\?,\s*'([a-z_]+)'/g)) { types.add(m[1]); sites++; }
    }
    return { types, sites };
}

describe('notification writers', () => {
    const { types, sites } = writtenTypes();

    it('the scan sees every kind of writer (it can\'t pass by finding nothing)', () => {
        expect(sites).toBeGreaterThan(30);
        for (const t of [
            'adopter_login_blocked', // raw insert(notifications)
            'household_linked', // householdNotices send(…, type)
            'profile_renamed', // profileIdentity sendTo(…, type)
            'pii_access_denied', // a ternary type
            'contact_entry_added', // notifyApprovers
            'merge_request', // notifyAdmins + createNotification
            'contract_result', // createNotification's default
            'follow_up_due', // the follow-up cron Worker's SQL
            'api_record', // an object built first, then passed to createNotification
        ]) expect(types, t).toContain(t);
    });

    it('every type written is in NOTIFICATION_TYPES (labelled and drawn)', () => {
        const known = new Set<string>(NOTIFICATION_TYPES);
        expect([...types].filter(t => !known.has(t)).sort()).toEqual([]);
    });
});
