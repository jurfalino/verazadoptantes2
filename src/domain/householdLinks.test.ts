import { describe, it, expect } from 'vitest';
import { countOpenAlerts, isLiveLink, linkNoticeRecipients, personLabel, summaryContacts, canReportNotLivingTogether, MAX_SUMMARY_CONTACTS } from './householdLinks';
import { KEPT_SEPARATE_FLAG_DETAILS_PREFIX } from './dedupPair';

describe('countOpenAlerts', () => {
    it('counts inaccuracy reports and open duplicate flags, not verification marks or closed duplicates', () => {
        expect(countOpenAlerts([
            { adopterId: 'a', reason: 'inaccurate_information' },
            { adopterId: 'a', reason: 'inaccurate' },
            { adopterId: 'a', reason: 'duplicate', targetAdopterId: 'b' },
            { adopterId: 'a', reason: 'duplicate', targetAdopterId: 'b', details: `${KEPT_SEPARATE_FLAG_DETAILS_PREFIX}household` },
            { adopterId: 'a', reason: 'duplicate', targetAdopterId: null },
            { adopterId: 'a', reason: 'verified_identity' },
            { adopterId: 'a', reason: 'verified_address' },
        ])).toBe(3);
        expect(countOpenAlerts([])).toBe(0);
    });
});

describe('isLiveLink', () => {
    const link = { memberId: 'm1', linkedAdopterId: 'p1' };
    it('is live while the host member still points at the profile', () => {
        expect(isLiveLink(link, [{ id: 'm1', profileId: 'p1' }])).toBe(true);
    });
    it('is not live once the member is gone or points elsewhere', () => {
        expect(isLiveLink(link, [])).toBe(false);
        expect(isLiveLink(link, [{ id: 'm1' }])).toBe(false);
        expect(isLiveLink(link, [{ id: 'm1', profileId: 'p2' }])).toBe(false);
        expect(isLiveLink(link, [{ id: 'm2', profileId: 'p1' }])).toBe(false);
    });
    it('counts a profile merged into the linked one when the caller names it (D51)', () => {
        expect(isLiveLink(link, [{ id: 'm1', profileId: 'absorbed' }], new Set(['p1', 'absorbed']))).toBe(true);
        expect(isLiveLink(link, [{ id: 'm1', profileId: 'absorbed' }])).toBe(false);
    });
});

describe('linkNoticeRecipients', () => {
    it('owner + team, lowercased, deduped, never the actor', () => {
        expect(linkNoticeRecipients('Owner@Example.com', ['owner@example.com', 'mate@example.com', 'ME@example.com'], 'me@example.com'))
            .toEqual(['owner@example.com', 'mate@example.com']);
    });
    it('nobody for an anonymous / system profile', () => {
        expect(linkNoticeRecipients('anonymous', ['x@example.com'], 'me@example.com')).toEqual([]);
        expect(linkNoticeRecipients(null, [], 'me@example.com')).toEqual([]);
    });
});

describe('personLabel', () => {
    it('display name, else the email handle — never the address', () => {
        expect(personLabel('ana@example.com', { 'ana@example.com': 'Ana Paz' })).toBe('Ana Paz');
        expect(personLabel('ana@example.com', {})).toBe('ana');
        expect(personLabel('anonymous', {})).toBeNull();
    });
});

describe('summaryContacts', () => {
    it('keeps contact types only, in order, capped with a remainder', () => {
        const many = Array.from({ length: MAX_SUMMARY_CONTACTS + 2 }, (_, i) => ({ type: 'phone' as const, value: `+54 11 0000 000${i}` }));
        const out = summaryContacts([{ type: 'other', value: 'nota' }, { type: 'alias', value: 'Juanchi' }, ...many]);
        expect(out.shown).toHaveLength(MAX_SUMMARY_CONTACTS);
        expect(out.shown.every(e => e.type === 'phone')).toBe(true);
        expect(out.more).toBe(2);
    });
});

describe('canReportNotLivingTogether', () => {
    it('the linked profile team or an admin', () => {
        expect(canReportNotLivingTogether({ viewerIsAdmin: false, viewerIsLinkedOwnerTeam: true })).toBe(true);
        expect(canReportNotLivingTogether({ viewerIsAdmin: true, viewerIsLinkedOwnerTeam: false })).toBe(true);
        expect(canReportNotLivingTogether({ viewerIsAdmin: false, viewerIsLinkedOwnerTeam: false })).toBe(false);
    });
});
