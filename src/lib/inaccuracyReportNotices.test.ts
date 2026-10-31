import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ getDb: vi.fn() }));
vi.mock('@/lib/orgMembership', () => ({
    normEmail: (e: string | null | undefined) => (e ?? '').trim().toLowerCase(),
    getOrgMemberEmailsFor: vi.fn(),
}));
vi.mock('@/lib/piiAccessRequest', () => ({ loadApprovers: vi.fn() }));

import { inaccuracyReportRecipients } from './inaccuracyReportNotices';

describe('inaccuracyReportRecipients — everyone who can edit, once, never the reporter', () => {
    it('owner, their team and privileged editors, deduped across case', () => {
        expect(inaccuracyReportRecipients(
            [['Owner@x.org'], ['owner@x.org', 'mate@x.org'], ['MATE@x.org', 'editor@y.org']],
            'reporter@z.org',
        )).toEqual(['owner@x.org', 'mate@x.org', 'editor@y.org']);
    });

    it('the reporter is never told, even when on the team', () => {
        expect(inaccuracyReportRecipients([['owner@x.org'], ['owner@x.org', 'Reporter@x.org']], 'reporter@x.org'))
            .toEqual(['owner@x.org']);
    });

    it('drops blanks and non-emails (import owners)', () => {
        expect(inaccuracyReportRecipients([[null, '', 'import:catpuccino'], [undefined]], 'r@z.org')).toEqual([]);
    });
});
