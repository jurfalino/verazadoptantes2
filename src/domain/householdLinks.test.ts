import { describe, it, expect } from 'vitest';
import { linkNoticeRecipients, personLabel, summaryContacts, MAX_SUMMARY_CONTACTS } from './householdLinks';

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
