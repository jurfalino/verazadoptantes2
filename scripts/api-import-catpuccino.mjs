#!/usr/bin/env node
/**
 * One-off: Catpuccino's adoption forms → BuenAdoptante, through the public API
 * (POST /api/v1/search, mode exact, adoption_request). Decisions: Jon, 2026-10-18.
 *
 *   API_KEY=ba_test_… node scripts/api-import-catpuccino.mjs <export.csv> --base https://staging.buenadoptante.org [--limit N] [--dry-run]
 *   API_KEY=ba_test_… node scripts/api-import-catpuccino.mjs <export.csv> --base … --undo
 *
 * - The key must be in import mode (Admin → API, PATCH importMode): no
 *   notifications, no daily counting, no LIKE scan in the duplicate check.
 * - Oldest first, and one person's forms never race (733 emails / 720 phones
 *   appear on several forms; two at once would make two profiles): --lanes N
 *   runs N forms at a time, but every form sharing an email or phone with
 *   another lands in the same lane, in date order.
 * - Resumable: every answer goes to a ledger (<csv>.<host>.ledger.jsonl) and a
 *   form already saved is skipped; a resend of the same form is a replay anyway.
 *   The payload must not change between runs (a changed one is 409 external_id_reused).
 * - --undo voids everything the ledger saved, newest first (so a profile the
 *   import created goes with its last activity).
 * - Stops on 429, repeated 5xx, partially_saved: those need a person to look.
 * - The data never leaves this machine except to the API. Nothing personal is printed.
 */
import fs from 'node:fs';

const args = process.argv.slice(2);
const csvPath = args.find(a => !a.startsWith('--'));
const opt = (name, dflt = null) => { const i = args.indexOf(`--${name}`); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : dflt; };
const BASE = String(opt('base', '')).replace(/\/$/, '');
const LIMIT = Number(opt('limit', 0)) || Infinity;
const DRY = !!opt('dry-run', false);
const UNDO = !!opt('undo', false);
const LANES = Math.max(1, Math.min(8, Number(opt('lanes', 1)) || 1));
const KEY = process.env.API_KEY;
const EMIT = opt('emit', null); // write the payloads (JSONL) to this path and exit: for offline checks
if (!csvPath || (!EMIT && (!BASE || !KEY))) {
    console.error('usage: API_KEY=… node scripts/api-import-catpuccino.mjs <export.csv> --base <https://host> [--limit N] [--dry-run] [--undo]');
    process.exit(2);
}
const ledgerPath = BASE ? `${csvPath}.${new URL(BASE).host}.ledger.jsonl` : null;

// ── CSV (RFC 4180: quotes, doubled quotes, newlines inside quotes) ──────────
function parseCsv(text) {
    const rows = []; let row = [], field = '', q = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (q) {
            if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c;
        } else if (c === '"') q = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n' || c === '\r') {
            if (c === '\r' && text[i + 1] === '\n') i++;
            row.push(field); rows.push(row); row = []; field = '';
        } else field += c;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    const [header, ...body] = rows.filter(r => r.some(v => v !== ''));
    return body.map(r => Object.fromEntries(header.map((h, i) => [h.replace(/^﻿/, ''), (r[i] ?? '').trim()])));
}

// ── Mapping ─────────────────────────────────────────────────────────────────
const SYSTEM = new Set(['entry_id', 'formulario', 'fecha', 'estado', 'tipo', 'animal_id', 'animal_tipo', 'animal_estado']);
const PERSON = { name: 'Nombre y Apellido', email: 'Email', phone: 'Celular', address: ['Direccion', 'Partido', 'Localidad'], fb: 'Facebook', ig: 'Instagram' };

/** "2022-06-04 15:24:01.6" is UTC (Catpuccino's export): the form's date in Argentina (UTC-3, no DST). */
function argentinaDate(fecha) {
    const t = Date.parse(fecha.replace(' ', 'T') + 'Z');
    return Number.isFinite(t) ? new Date(t - 3 * 3600_000).toISOString().slice(0, 10) : undefined;
}

/** Who a row is, for counting distinct applicants (email, else phone digits, else name). */
const applicantKey = r => (r[PERSON.email] || '').toLowerCase() || (r[PERSON.phone] || '').replace(/\D/g, '') || (r[PERSON.name] || '').toLowerCase();

/** Social answers shared by 3+ different applicants are not accounts ("no", "-", the rescue's own page). Jon, 2026-10-18. */
function sharedSocials(rows) {
    const by = new Map();
    for (const r of rows) for (const col of [PERSON.fb, PERSON.ig]) {
        const v = (r[col] || '').toLowerCase().replace(/^@+/, '').trim();
        if (!v) continue;
        if (!by.has(v)) by.set(v, new Set());
        by.get(v).add(applicantKey(r));
    }
    return new Set([...by].filter(([, who]) => who.size >= 3).map(([v]) => v));
}

function payloadOf(r, shared) {
    const socials = [];
    for (const [col, platform] of [[PERSON.fb, 'facebook'], [PERSON.ig, 'instagram']]) {
        const v = r[col];
        if (v && !shared.has(v.toLowerCase().replace(/^@+/, '').trim())) socials.push({ platform, handle: v.slice(0, 200) });
    }
    const address = PERSON.address.map(c => r[c]).filter(Boolean).join(', ').slice(0, 300);
    const formContent = {};
    for (const [k, v] of Object.entries(r)) {
        if (!v || SYSTEM.has(k)) continue;
        if (/^forms\//.test(v)) continue; // a photo path in Catpuccino's storage: means nothing here
        formContent[k] = v;
    }
    const person = { fullName: r[PERSON.name] || undefined, email: r[PERSON.email] || undefined, phone: r[PERSON.phone]?.slice(0, 200) || undefined, address: address || undefined, socials: socials.length ? socials : undefined };
    return {
        mode: 'exact',
        person: JSON.parse(JSON.stringify(person)),
        activity: JSON.parse(JSON.stringify({
            activityType: 'adoption_request',
            externalId: `catpuccino-${r.entry_id}`,
            date: argentinaDate(r.fecha),
            animalName: r.animal_nombre ? r.animal_nombre.slice(0, 100) : undefined,
            species: r.animal_tipo || undefined, // P / G — the API reads one-letter codes
            formContent,
        })),
    };
}

/** Forms linked by a shared email or phone (any number in the field) go to the same lane. */
function lanesOf(rows, n) {
    const parent = rows.map((_, i) => i);
    const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const owner = new Map(), owner2 = new Map();
    rows.forEach((r, i) => {
        const keys = [];
        const email = (r[PERSON.email] || '').trim().toLowerCase();
        if (email.includes('@')) keys.push(`e:${email}`);
        for (const m of (r[PERSON.phone] || '').matchAll(/\+?\d[\d\s().-]{5,}\d/g)) {
            const d = m[0].replace(/\D/g, '');
            if (d.length >= 6) keys.push(`p:${d.slice(-8)}`);
        }
        owner2.set(i, keys.map(k => [k, i]));
        for (const k of keys) { if (owner.has(k)) parent[find(i)] = find(owner.get(k)); else owner.set(k, i); }
    });
    const groups = new Map();
    rows.forEach((r, i) => { const g = find(i); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(r); });
    // Biggest groups first, each to the currently lightest lane; rows stay in date order inside a lane.
    const lanes = Array.from({ length: n }, () => []);
    for (const g of [...groups.values()].sort((a, b) => b.length - a.length)) lanes.reduce((m, l) => (l.length < m.length ? l : m)).push(...g);
    // Guard: no email / phone may appear in two lanes.
    const laneOfKey = new Map();
    lanes.forEach((l, li) => l.forEach(r => {
        const i = rows.indexOf(r);
        for (const [k, owner] of owner2.get(i) ?? []) { void owner; if (laneOfKey.has(k) && laneOfKey.get(k) !== li) throw new Error(`lane split on ${k.slice(0, 2)}…`); laneOfKey.set(k, li); }
    }));
    return lanes.map(l => l.sort((a, b) => a.fecha.localeCompare(b.fecha) || Number(a.entry_id) - Number(b.entry_id)));
}

// ── HTTP ────────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function call(method, path, body) {
    const headers = { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' };
    if (DRY) headers['x-dry-run'] = '1';
    const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => null);
    return { status: res.status, json, retryAfter: Number(res.headers.get('retry-after') || 0), ray: res.headers.get('cf-ray') };
}

function readLedger() {
    if (!fs.existsSync(ledgerPath)) return [];
    return fs.readFileSync(ledgerPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}
const append = entry => fs.appendFileSync(ledgerPath, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');

// ── Run ─────────────────────────────────────────────────────────────────────
async function importAll() {
    const rows = parseCsv(fs.readFileSync(csvPath, 'utf8')).sort((a, b) => a.fecha.localeCompare(b.fecha) || Number(a.entry_id) - Number(b.entry_id));
    const shared = sharedSocials(rows);
    const done = new Set(readLedger().filter(e => e.op === 'save' && (e.status === 200 || e.status === 422) && !e.dryRun).map(e => e.externalId));
    console.log(`${rows.length} forms; ${done.size} already in the ledger; ${shared.size} shared social values treated as "no account"${DRY ? '; DRY RUN' : ''}`);
    let sent = 0, fiveXX = 0, stop = false;
    const tally = {};
    const started = Date.now();
    const lanes = lanesOf(rows, LANES);
    if (LANES > 1) console.log(`${LANES} lanes: ${lanes.map(l => l.length).join(' / ')} forms`);
    if (opt('plan', false)) return;
    await Promise.all(lanes.map(lane => runLane(lane)));
    console.log(`done: ${sent} sent in ${Math.round((Date.now() - started) / 1000)} s · ${JSON.stringify(tally)}`);
    console.log(`ledger: ${ledgerPath}`);

    async function runLane(lane) {
    for (const r of lane) {
        if (stop || sent >= LIMIT) break;
        const body = payloadOf(r, shared);
        const externalId = body.activity.externalId;
        if (done.has(externalId)) continue;
        let res, tries = 0;
        for (;;) {
            const t0 = Date.now();
            try { res = await call('POST', '/api/v1/search', body); } catch (e) { res = { status: 0, json: { error: { code: 'network', message: String(e) } } }; }
            res.ms = Date.now() - t0;
            if (res.status === 409 && res.json?.error?.code === 'request_in_progress' && tries++ < 70) { await sleep(Math.max(2, res.retryAfter) * 1000); continue; }
            if ((res.status >= 500 || res.status === 0) && tries++ < 3) { await sleep(5000 * tries); continue; }
            break;
        }
        sent++;
        const j = res.json ?? {};
        const entry = {
            op: 'save', externalId, status: res.status, ms: res.ms, dryRun: DRY || undefined,
            code: j.error?.code, field: j.error?.field, details: j.error?.details?.map(d => d.code),
            match: j.match, action: j.saved?.action, profileId: j.saved?.profileId, activityId: j.saved?.activityId,
            replayed: j.replayed || undefined, warnings: j.warnings?.map(w => `${w.field}:${w.reason}`), requestId: j.requestId,
        };
        append(entry);
        const label = res.status === 200 ? (entry.replayed ? 'replayed' : entry.action) : `${res.status} ${entry.code}`;
        tally[label] = (tally[label] ?? 0) + 1;
        if (sent % 50 === 0) {
            const rate = (Date.now() - started) / sent;
            console.log(`${sent} sent · ${Math.round(rate)} ms/form · ${JSON.stringify(tally)}${res.ray ? ` · colo ${res.ray.split('-').pop()}` : ''}`);
        }
        if (res.status === 429) { console.error('STOP: 429 (limit reached) —', entry.code); stop = true; break; }
        if (res.status === 409 && entry.code === 'partially_saved') { console.error(`STOP: partially_saved on ${externalId} — void it and resend (see ledger)`); stop = true; break; }
        if (res.status === 409 && entry.code === 'external_id_reused') { console.error(`STOP: ${externalId} was saved with a different payload — the mapping changed between runs`); stop = true; break; }
        if (res.status >= 500 || res.status === 0) { if (++fiveXX >= 3) { console.error('STOP: 3 forms in a row failed with server errors'); stop = true; break; } } else fiveXX = 0;
    }
    }
}

async function undoAll() {
    const saved = readLedger().filter(e => e.op === 'save' && e.status === 200 && e.activityId && !e.replayed && !e.dryRun);
    const voided = new Set(readLedger().filter(e => e.op === 'void' && (e.status === 200 || e.code === 'already_voided')).map(e => e.activityId));
    const todo = saved.filter(e => !voided.has(e.activityId)).reverse(); // newest first
    console.log(`${todo.length} activities to void (newest first)`);
    let n = 0;
    for (const e of todo) {
        if (n >= LIMIT) break;
        const res = await call('POST', `/api/v1/activities/${e.activityId}/void`);
        append({ op: 'void', externalId: e.externalId, activityId: e.activityId, status: res.status, code: res.json?.error?.code, profileVoided: res.json?.profileVoided });
        if (res.status === 429) { console.error('STOP: 429'); break; }
        if (++n % 50 === 0) console.log(`${n} voided`);
    }
    console.log(`done: ${n} voided`);
}

function emitAll() {
    const rows = parseCsv(fs.readFileSync(csvPath, 'utf8')).sort((a, b) => a.fecha.localeCompare(b.fecha) || Number(a.entry_id) - Number(b.entry_id));
    const shared = sharedSocials(rows);
    fs.writeFileSync(EMIT, rows.map(r => JSON.stringify(payloadOf(r, shared))).join('\n') + '\n');
    console.log(`${rows.length} payloads → ${EMIT}; ${shared.size} shared social values`);
}

(EMIT ? Promise.resolve(emitAll()) : UNDO ? undoAll() : importAll()).catch(e => { console.error('crashed:', e instanceof Error ? e.message : e); process.exit(1); });
