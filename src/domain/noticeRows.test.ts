/**
 * «Avisos» rows (Jon 2026-11-11): the bell shows every notice; email goes only
 * when someone is waiting on you, plus the rows the person switches on.
 */
import { describe, it, expect } from 'vitest';
import { NOTIFICATION_TYPES } from './constants';
import {
    NOTICE_ROWS, ALWAYS_EMAILED_TYPES, ADMIN_ONLY_TYPES, NOT_WRITTEN_TYPES, BELL_ONLY_TYPES,
    rowForType, parseNoticePrefs, withNoticePref, isNoticeEmailOn, noticeEmailVerdict,
    noticeThrottleKey, unsubscribableRow, unsubscribeRows, withNoticePrefs, visibleNoticeRows, SWITCHABLE_ROW_KEYS,
} from './noticeRows';

const LIVE = NOTIFICATION_TYPES as readonly string[];

describe('every live type has exactly one home', () => {
    it.each(LIVE.map(t => [t]))('%s', (type) => {
        const homes = [
            NOTICE_ROWS.filter(r => (r.types as readonly string[]).includes(type)).length,
            ALWAYS_EMAILED_TYPES.includes(type) ? 1 : 0,
            ADMIN_ONLY_TYPES.includes(type) ? 1 : 0,
            BELL_ONLY_TYPES.includes(type) ? 1 : 0,
            NOT_WRITTEN_TYPES.includes(type) ? 1 : 0,
        ].reduce((a, b) => a + b, 0);
        expect(homes).toBe(1);
    });

    it('rows and lists name only live types', () => {
        const named = [...NOTICE_ROWS.flatMap(r => r.types), ...ALWAYS_EMAILED_TYPES, ...ADMIN_ONLY_TYPES, ...BELL_ONLY_TYPES, ...NOT_WRITTEN_TYPES];
        expect(named.filter(t => !LIVE.includes(t))).toEqual([]);
    });

    it('the rows, in the order of the approved screen', () => {
        expect(NOTICE_ROWS.map(r => [r.group, r.key])).toEqual([
            ['waiting', 'merge_request'], ['waiting', 'pii_request'], ['waiting', 'pair_message'],
            ['waiting', 'form'], ['waiting', 'contract'], ['waiting', 'followups'],
            ['profile_changes', 'content'], ['profile_changes', 'contact'], ['profile_changes', 'rename'],
            ['profile_changes', 'household'], ['profile_changes', 'inaccuracy'], ['profile_changes', 'duplicates'],
            ['news', 'answers'], ['news', 'transfer'], ['news', 'group'],
        ]);
    });

    it.each([
        ['merge_request', 'merge_request'], ['pii_access_request', 'pii_request'], ['pair_message', 'pair_message'],
        ['form_submission', 'form'], ['contract_result', 'contract'], ['follow_up_due', 'followups'],
        ['profile_content_added', 'content'], ['contact_entry_added', 'contact'], ['profile_renamed', 'rename'],
        ['household_contribution', 'household'], ['household_linked', 'household'], ['household_member_removed', 'household'],
        ['inaccuracy_reported', 'inaccuracy'],
        ['duplicate_flagged', 'duplicates'], ['adopter_merged', 'duplicates'], ['merge_dispute_resolved', 'duplicates'],
        ['contract_attached', 'duplicates'], ['form_attached', 'duplicates'],
        ['merge_request_resolved', 'answers'], ['pii_access_approved', 'answers'], ['pii_access_denied', 'answers'], ['pii_access_revoked', 'answers'],
        ['ownership_transferred', 'transfer'], ['member_joined', 'group'],
    ])('%s -> %s', (type, key) => {
        expect(rowForType(type)?.key).toBe(key);
    });

    it('admin-only, always-emailed, bell-only and no longer written types have no row', () => {
        for (const t of [...ADMIN_ONLY_TYPES, ...ALWAYS_EMAILED_TYPES, ...BELL_ONLY_TYPES, ...NOT_WRITTEN_TYPES, 'form_result', 'system']) {
            expect(rowForType(t), t).toBeNull();
        }
    });
});

describe('defaults', () => {
    // Jon 2026-11-12: «Le cambian el nombre» (its email carries «Deshacer») and «Responden tu pedido…»
    // (the asker is the one waiting) default on.
    it('the three «Alguien espera tu respuesta» answers are always emailed; form, contract, rename and answers on; the rest off', () => {
        expect(Object.fromEntries(NOTICE_ROWS.map(r => [r.key, r.email]))).toEqual({
            merge_request: 'always', pii_request: 'always', pair_message: 'always',
            form: 'on', contract: 'on', followups: 'followups',
            content: 'off', contact: 'off', rename: 'on', household: 'off', inaccuracy: 'off', duplicates: 'off',
            answers: 'on', transfer: 'off', group: 'off',
        });
    });

    it('nothing stored: form, contract, rename and answers on, every other switch off', () => {
        const prefs = parseNoticePrefs(null);
        expect(SWITCHABLE_ROW_KEYS.filter(k => isNoticeEmailOn(prefs, k))).toEqual(['form', 'contract', 'rename', 'answers']);
    });

    it('nothing stored: a rename and an answer to your request are emailed', () => {
        const none = parseNoticePrefs(null);
        expect(noticeEmailVerdict({ type: 'profile_renamed' }, none)).toBe('send');
        for (const type of ['merge_request_resolved', 'pii_access_approved', 'pii_access_denied', 'pii_access_revoked']) {
            expect(noticeEmailVerdict({ type }, none), type).toBe('send');
        }
    });

    it('a stored false still wins over the new defaults', () => {
        const prefs = parseNoticePrefs('{"rename":false,"answers":false}');
        expect(isNoticeEmailOn(prefs, 'rename')).toBe(false);
        expect(isNoticeEmailOn(prefs, 'answers')).toBe(false);
        expect(noticeEmailVerdict({ type: 'profile_renamed' }, prefs)).toBe('pref_off');
        expect(noticeEmailVerdict({ type: 'pii_access_approved' }, prefs)).toBe('pref_off');
    });

    it('the check-up row is not stored here (followup_settings.emailReminders is its switch)', () => {
        expect(SWITCHABLE_ROW_KEYS).not.toContain('followups');
        expect(parseNoticePrefs('{"followups":true}')).toEqual({});
    });
});

describe('the old category switches', () => {
    it('«Formularios y contratos» off -> the form and contract rows off', () => {
        const prefs = parseNoticePrefs('{"forms":false}');
        expect(isNoticeEmailOn(prefs, 'form')).toBe(false);
        expect(isNoticeEmailOn(prefs, 'contract')).toBe(false);
    });

    it('every other old category is ignored: the new defaults apply', () => {
        const prefs = parseNoticePrefs('{"forms":true,"merges":true,"profile_changes":true,"contact_access":true,"other":true,"api":false,"requests":false}');
        expect(SWITCHABLE_ROW_KEYS.filter(k => isNoticeEmailOn(prefs, k))).toEqual(['form', 'contract', 'rename', 'answers']);
    });

    it('an old category stored false is ignored too: rename and answers still default on', () => {
        const prefs = parseNoticePrefs('{"merges":false,"contact_access":false,"profile_changes":false}');
        expect(isNoticeEmailOn(prefs, 'rename')).toBe(true);
        expect(isNoticeEmailOn(prefs, 'answers')).toBe(true);
    });

    it('a row value stored since wins over the old category', () => {
        const prefs = parseNoticePrefs('{"forms":false,"form":true}');
        expect(isNoticeEmailOn(prefs, 'form')).toBe(true);
        expect(isNoticeEmailOn(prefs, 'contract')).toBe(false);
    });

    it('switching another row on keeps the migrated form and contract rows off', () => {
        const stored = withNoticePref('{"forms":false}', 'group', true);
        const prefs = parseNoticePrefs(stored);
        expect(isNoticeEmailOn(prefs, 'group')).toBe(true);
        expect(isNoticeEmailOn(prefs, 'form')).toBe(false);
        expect(isNoticeEmailOn(prefs, 'contract')).toBe(false);
    });

    it('malformed, non-object and non-boolean values are dropped', () => {
        expect(parseNoticePrefs('{nope')).toEqual({});
        expect(parseNoticePrefs('[1]')).toEqual({});
        expect(parseNoticePrefs('{"form":"false","bogus":true}')).toEqual({});
    });
});

describe('noticeEmailVerdict', () => {
    const none = parseNoticePrefs(null);
    it('the always rows are emailed whatever is stored', () => {
        const allOff = parseNoticePrefs(JSON.stringify(Object.fromEntries(SWITCHABLE_ROW_KEYS.map(k => [k, false]))));
        for (const type of ['merge_request', 'pii_access_request', 'pair_message', 'api_access']) {
            expect(noticeEmailVerdict({ type }, allOff), type).toBe('send');
        }
    });

    // Jon 2026-11-12: every signed contract (the rescuer sent it and is waiting), duplicates or not.
    it('every signed contract follows the «Un adoptante firma un contrato» switch, with or without possible duplicates', () => {
        const off = parseNoticePrefs('{"contract":false}');
        for (const metadata of [{ matchCount: 2 }, { matchCount: 0 }, {}, undefined]) {
            expect(noticeEmailVerdict({ type: 'contract_result', metadata }, none), JSON.stringify(metadata)).toBe('send');
            expect(noticeEmailVerdict({ type: 'contract_result', metadata }, off), JSON.stringify(metadata)).toBe('pref_off');
        }
    });

    it('a switchable row follows its switch', () => {
        expect(noticeEmailVerdict({ type: 'form_submission' }, none)).toBe('send');
        expect(noticeEmailVerdict({ type: 'adopter_merged' }, none)).toBe('pref_off');
        expect(noticeEmailVerdict({ type: 'adopter_merged' }, parseNoticePrefs('{"duplicates":true}'))).toBe('send');
        expect(noticeEmailVerdict({ type: 'member_joined' }, parseNoticePrefs('{"group":true}'))).toBe('send');
    });

    it('being removed from the group is the bell only, even with «Tu grupo» on (decision F6: no email)', () => {
        expect(BELL_ONLY_TYPES).toEqual(['member_removed']);
        expect(noticeEmailVerdict({ type: 'member_removed' }, parseNoticePrefs('{"group":true}'))).toBe('not_emailed');
        expect(noticeEmailVerdict({ type: 'member_removed' }, none)).toBe('not_emailed');
        expect(rowForType('member_joined')?.types).toEqual(['member_joined']);
    });

    it('admin-only types are never emailed', () => {
        for (const type of ADMIN_ONLY_TYPES) expect(noticeEmailVerdict({ type }, none), type).toBe('admin_only');
    });

    it('check-ups, no-longer-written and unknown types never go through the email twin', () => {
        for (const type of ['follow_up_due', ...NOT_WRITTEN_TYPES, 'form_result', 'bogus']) {
            expect(noticeEmailVerdict({ type }, none), type).toBe('not_emailed');
        }
    });
});

describe('noticeThrottleKey', () => {
    it('never throttled: a request to join, a message, a rename (its «Deshacer» rides in the email)', () => {
        for (const t of ['merge_request', 'pair_message', 'profile_renamed']) expect(noticeThrottleKey(t)).toBeNull();
    });
    it('an always-emailed type throttles per type; a switchable row per row', () => {
        expect(noticeThrottleKey('pii_access_request')).toBe('type:pii_access_request');
        expect(noticeThrottleKey('api_access')).toBe('type:api_access');
        expect(noticeThrottleKey('form_submission')).toBe('row:form');
        expect(noticeThrottleKey('adopter_merged')).toBe(noticeThrottleKey('duplicate_flagged'));
        expect(noticeThrottleKey('adopter_merged')).not.toBe(noticeThrottleKey('form_submission'));
    });
});

describe('unsubscribableRow', () => {
    it('a switchable row', () => {
        expect(unsubscribableRow('form')).toBe('form');
        expect(unsubscribableRow('duplicates')).toBe('duplicates');
    });
    it('not an always row, the check-up row (another screen), an old category or anything else', () => {
        for (const k of ['merge_request', 'pii_request', 'pair_message', 'followups', 'forms', 'requests', 'bogus', '']) {
            expect(unsubscribableRow(k), k).toBeNull();
        }
    });
});

describe('unsubscribeRows (what a link\'s `c` switches off)', () => {
    it('a row key: that row', () => {
        expect(unsubscribeRows('form')).toEqual(['form']);
        expect(unsubscribeRows('group')).toEqual(['group']);
    });
    // Links in emails sent before «Avisos» carry the old categories (src/domain/emailCategories.ts, gone).
    it('forms → the form and contract rows', () => {
        expect(unsubscribeRows('forms')).toEqual(['form', 'contract']);
    });
    it('merges → duplicates/merges, and «Responden tu pedido…» (merge answers lived in merges)', () => {
        expect(unsubscribeRows('merges')).toEqual(['duplicates', 'answers']);
    });
    it('contact_access → «Responden tu pedido…»', () => {
        expect(unsubscribeRows('contact_access')).toEqual(['answers']);
    });
    it('profile_changes → the profile-change rows, and «Te pasan un perfil» (ownership_transferred lived there)', () => {
        expect(unsubscribeRows('profile_changes')).toEqual(['content', 'contact', 'rename', 'household', 'inaccuracy', 'transfer']);
    });
    it('other → «Tu grupo»', () => {
        expect(unsubscribeRows('other')).toEqual(['group']);
    });
    it('every mapped row is switchable', () => {
        for (const c of ['forms', 'merges', 'contact_access', 'profile_changes', 'other']) {
            for (const r of unsubscribeRows(c)!) expect(SWITCHABLE_ROW_KEYS, `${c} → ${r}`).toContain(r);
        }
    });
    it('nothing for an always row, the check-up row, the old always-on category or anything else', () => {
        for (const k of ['merge_request', 'pii_request', 'pair_message', 'followups', 'requests', 'bogus', '', 'toString', '__proto__']) {
            expect(unsubscribeRows(k), k).toBeNull();
        }
    });
});

describe('unsubscribing turns the default-on rows off', () => {
    const offAfter = (c: string) => parseNoticePrefs(withNoticePrefs(null, unsubscribeRows(c)!, false));
    it('«Le cambian el nombre»: its own link, and an old «profile_changes» link', () => {
        expect(isNoticeEmailOn(offAfter('rename'), 'rename')).toBe(false);
        expect(isNoticeEmailOn(offAfter('profile_changes'), 'rename')).toBe(false);
    });
    it('«Responden tu pedido…»: its own link, and old «merges» / «contact_access» links', () => {
        for (const c of ['answers', 'merges', 'contact_access']) expect(isNoticeEmailOn(offAfter(c), 'answers'), c).toBe(false);
    });
    it('switching one off leaves the other on', () => {
        expect(isNoticeEmailOn(offAfter('rename'), 'answers')).toBe(true);
    });
});

describe('withNoticePrefs', () => {
    it('switches several rows in one write, keeping the rest (migrated)', () => {
        expect(JSON.parse(withNoticePrefs('{"forms":false,"group":true}', ['duplicates', 'answers'], false)))
            .toEqual({ form: false, contract: false, group: true, duplicates: false, answers: false });
    });
});

describe('visibleNoticeRows (Configuración → «Avisos»)', () => {
    it('ENABLE_FOLLOWUPS off: no «Toca un control de seguimiento» row, every other row stays', () => {
        const keys = visibleNoticeRows(false).map(r => r.key);
        expect(keys).not.toContain('followups');
        expect(keys).toHaveLength(NOTICE_ROWS.length - 1);
    });
    it('on: every row', () => {
        expect(visibleNoticeRows(true).map(r => r.key)).toEqual(NOTICE_ROWS.map(r => r.key));
    });
});
