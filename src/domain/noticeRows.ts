/**
 * «Avisos» (Configuración, Jon 2026-11-11). The bell shows every notice and has
 * no switches. Email goes only when someone is waiting on you, plus the rows
 * the person switches on, one row at a time.
 *
 * Each row is one thing that can happen, in the rescuer's words, and maps to
 * the notification types it covers. The email default and the lock are per row:
 * - 'always': emailed whatever is stored (someone waits on an answer);
 * - 'on' / 'off': a switch, with that default;
 * - 'followups': the daily check-up digest, whose switch is
 *   `followup_settings.emailReminders` (the same value «Seguimientos de
 *   adopción» shows, so the two screens can't disagree). The cron Worker sends
 *   that email; the email twin never sends `follow_up_due`.
 *
 * Outside the rows: `api_access` is always emailed; admin-only types are bell
 * only; four types are no longer written (the profile's history has them) but
 * keep their labels so old rows still render.
 *
 * The switches live in `user_profiles.email_prefs` (JSON, row key → boolean).
 * Pure; no `@/` imports.
 */

export type NoticeGroup = 'waiting' | 'profile_changes' | 'news';
export type NoticeEmail = 'always' | 'on' | 'off' | 'followups';

export const NOTICE_ROWS = [
    { key: 'merge_request', group: 'waiting', email: 'always', types: ['merge_request'] },
    { key: 'pii_request', group: 'waiting', email: 'always', types: ['pii_access_request'] },
    { key: 'pair_message', group: 'waiting', email: 'always', types: ['pair_message'] },
    { key: 'form', group: 'waiting', email: 'on', types: ['form_submission'] },
    { key: 'contract', group: 'waiting', email: 'on', types: ['contract_result'] },
    { key: 'followups', group: 'waiting', email: 'followups', types: ['follow_up_due'] },
    { key: 'content', group: 'profile_changes', email: 'off', types: ['profile_content_added'] },
    { key: 'contact', group: 'profile_changes', email: 'off', types: ['contact_entry_added'] },
    { key: 'rename', group: 'profile_changes', email: 'off', types: ['profile_renamed'] },
    { key: 'household', group: 'profile_changes', email: 'off', types: ['household_contribution', 'household_linked', 'household_member_removed'] },
    { key: 'inaccuracy', group: 'profile_changes', email: 'off', types: ['inaccuracy_reported'] },
    { key: 'duplicates', group: 'profile_changes', email: 'off', types: ['duplicate_flagged', 'adopter_merged', 'merge_dispute_resolved', 'contract_attached', 'form_attached'] },
    { key: 'answers', group: 'news', email: 'off', types: ['merge_request_resolved', 'pii_access_approved', 'pii_access_denied', 'pii_access_revoked'] },
    { key: 'transfer', group: 'news', email: 'off', types: ['ownership_transferred'] },
    { key: 'group', group: 'news', email: 'off', types: ['member_joined', 'member_removed'] },
] as const satisfies readonly { key: string; group: NoticeGroup; email: NoticeEmail; types: readonly string[] }[];

export type NoticeRow = typeof NOTICE_ROWS[number];
export type NoticeRowKey = NoticeRow['key'];
/** The rows with a switch stored in email_prefs (not 'always', not the check-up row). */
export type SwitchableRowKey = Extract<NoticeRow, { email: 'on' | 'off' }>['key'];

export const NOTICE_GROUPS: readonly NoticeGroup[] = ['waiting', 'profile_changes', 'news'];

export const SWITCHABLE_ROW_KEYS: readonly SwitchableRowKey[] = NOTICE_ROWS
    .filter((r): r is Extract<NoticeRow, { email: 'on' | 'off' }> => r.email === 'on' || r.email === 'off')
    .map(r => r.key);

/** Emailed whatever is stored, with no row on the screen. */
export const ALWAYS_EMAILED_TYPES: readonly string[] = ['api_access'];

/** Admin-queue items: the bell only, never emailed, not shown to rescuers. */
export const ADMIN_ONLY_TYPES: readonly string[] = [
    'merge_disputed', 'household_member_disputed', 'adopter_flagged', 'deletion_request', 'api_access_requested', 'adopter_login_blocked',
];

/**
 * No longer written: the profile's history has the information. The types and
 * labels stay so old rows still render. Listed under «No te avisamos».
 */
export const NOT_WRITTEN_TYPES: readonly string[] = [
    'profile_rename_undone', 'household_also_lives_with', 'household_relationship_changed', 'api_record',
];

const ROW_BY_TYPE: ReadonlyMap<string, NoticeRow> = new Map(NOTICE_ROWS.flatMap(r => r.types.map(t => [t as string, r] as const)));

export function rowForType(type: string): NoticeRow | null {
    return ROW_BY_TYPE.get(type) ?? null;
}

export type NoticePrefs = Partial<Record<SwitchableRowKey, boolean>>;

const isSwitchable = (k: string): k is SwitchableRowKey => (SWITCHABLE_ROW_KEYS as readonly string[]).includes(k);

/**
 * Parse stored prefs JSON. Malformed input, unknown keys and non-boolean values
 * are dropped. The old category switches are ignored, except one: «Formularios
 * y contratos» off (`forms: false`) turns the form and contract rows off unless
 * a row value was stored since.
 */
export function parseNoticePrefs(raw: string | null | undefined): NoticePrefs {
    if (!raw) return {};
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return {};
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const obj = parsed as Record<string, unknown>;
    const out: NoticePrefs = {};
    for (const key of SWITCHABLE_ROW_KEYS) {
        const value = obj[key];
        if (typeof value === 'boolean') out[key] = value;
    }
    if (obj.forms === false) {
        if (out.form === undefined) out.form = false;
        if (out.contract === undefined) out.contract = false;
    }
    return out;
}

/**
 * The JSON to store after switching one row: the parsed (and so migrated)
 * prefs plus the new value. Writing the migrated values keeps an old
 * «Formularios y contratos» off when another row is switched.
 */
export function withNoticePref(raw: string | null | undefined, key: SwitchableRowKey, enabled: boolean): string {
    return JSON.stringify({ ...parseNoticePrefs(raw), [key]: enabled });
}

export function isNoticeEmailOn(prefs: NoticePrefs, key: SwitchableRowKey): boolean {
    const stored = prefs[key];
    if (typeof stored === 'boolean') return stored;
    return NOTICE_ROWS.find(r => r.key === key)?.email === 'on';
}

export type NoticeEmailVerdict = 'send' | 'pref_off' | 'admin_only' | 'not_emailed';

/** Whether the email twin may send this notice to a person with these switches. */
export function noticeEmailVerdict(n: { type: string; metadata?: Record<string, unknown> | null }, prefs: NoticePrefs): NoticeEmailVerdict {
    if (ADMIN_ONLY_TYPES.includes(n.type)) return 'admin_only';
    if (ALWAYS_EMAILED_TYPES.includes(n.type)) return 'send';
    const row = rowForType(n.type);
    if (!row || row.email === 'followups') return 'not_emailed';
    // A signed contract is emailed only when it has possible duplicates to review.
    if (row.key === 'contract') {
        const matches = n.metadata?.matchCount;
        if (!(typeof matches === 'number' && matches > 0)) return 'not_emailed';
    }
    if (row.email === 'always') return 'send';
    return isNoticeEmailOn(prefs, row.key) ? 'send' : 'pref_off';
}

/**
 * Each one is its own question (merge_request), a person writing to a person
 * (pair_message), or the safeguard of an open edit (profile_renamed: its
 * «Deshacer» rides in that email, so a household notice minutes earlier must
 * not swallow it).
 */
const NEVER_THROTTLED_TYPES: readonly string[] = ['merge_request', 'pair_message', 'profile_renamed'];

/**
 * What a recently emailed notification must share for this one to be throttled
 * (one email per recipient per key per 10 minutes), or null when never
 * throttled. Always-emailed types throttle per type (`pii_access_request` comes
 * in bursts from bulk imports); switchable rows per row.
 */
export function noticeThrottleKey(type: string): string | null {
    if (NEVER_THROTTLED_TYPES.includes(type)) return null;
    const row = rowForType(type);
    if (!row || row.email === 'always') return `type:${type}`;
    return `row:${row.key}`;
}

/** The row an unsubscribe link may switch off: a switchable row, else null. */
export function unsubscribableRow(key: string): SwitchableRowKey | null {
    return isSwitchable(key) ? key : null;
}

/**
 * Emails sent before «Avisos» carry an old category in their unsubscribe link
 * (`c=`, signed the same way). Each maps to the rows that now hold its types:
 * merge answers (merge_request_resolved) were in «merges», ownership transfers in
 * «profile_changes». «requests» was always on and never had a link; «api» has no
 * switchable row left (api_access is always emailed, api_record is not written).
 */
const LEGACY_UNSUBSCRIBE_ROWS: ReadonlyMap<string, readonly SwitchableRowKey[]> = new Map<string, readonly SwitchableRowKey[]>([
    ['forms', ['form', 'contract']],
    ['merges', ['duplicates', 'answers']],
    ['contact_access', ['answers']],
    ['profile_changes', ['content', 'contact', 'rename', 'household', 'inaccuracy', 'transfer']],
    ['other', ['group']],
]);

/** The rows an unsubscribe link's `c` switches off: a switchable row, or an old category's rows; else null. */
export function unsubscribeRows(key: string): SwitchableRowKey[] | null {
    const row = unsubscribableRow(key);
    if (row) return [row];
    const legacy = LEGACY_UNSUBSCRIBE_ROWS.get(key);
    return legacy ? [...legacy] : null;
}

/** withNoticePref for several rows at once (one read-modify-write). */
export function withNoticePrefs(raw: string | null | undefined, keys: readonly SwitchableRowKey[], enabled: boolean): string {
    const next: NoticePrefs = parseNoticePrefs(raw);
    for (const k of keys) next[k] = enabled;
    return JSON.stringify(next);
}

/** The rows Configuración → «Avisos» shows: the check-up row only while ENABLE_FOLLOWUPS is on. */
export function visibleNoticeRows(followupsOn: boolean): readonly NoticeRow[] {
    return followupsOn ? NOTICE_ROWS : NOTICE_ROWS.filter(r => r.email !== 'followups');
}
