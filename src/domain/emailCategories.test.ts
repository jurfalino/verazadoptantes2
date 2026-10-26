import { describe, it, expect } from 'vitest';
import {
    EMAIL_CATEGORIES,
    ALWAYS_ON_CATEGORIES,
    categoryForType,
    emailThrottleKey,
    parseEmailPrefs,
    isEmailEnabled,
    visibleCategories,
} from './emailCategories';

describe('categoryForType', () => {
    it.each([
        ['merge_request', 'requests'],
        ['pii_access_request', 'requests'],
        ['form_attached', 'forms'],
        ['contract_result', 'forms'],
        ['adopter_merged', 'merges'],
        ['merge_dispute_resolved', 'merges'],
        ['merge_disputed', 'other'],
        ['duplicate_candidate', 'merges'],
        ['pii_access_revoked', 'contact_access'],
        ['ownership_transferred', 'profile_changes'],
        ['household_linked', 'profile_changes'],
        ['household_link_removed', 'profile_changes'],
        ['household_link_disputed', 'other'],
        ['api_record', 'api'],
        ['member_joined', 'other'],
    ] as const)('%s -> %s', (type, cat) => {
        expect(categoryForType(type)).toBe(cat);
    });
});

describe('isEmailEnabled', () => {
    it('missing means enabled', () => {
        expect(isEmailEnabled({}, 'forms')).toBe(true);
    });
    it('explicit false disables', () => {
        expect(isEmailEnabled({ forms: false }, 'forms')).toBe(false);
    });
    it('always-on categories ignore false', () => {
        expect(isEmailEnabled({ requests: false }, 'requests')).toBe(true);
        expect(ALWAYS_ON_CATEGORIES.has('requests')).toBe(true);
    });
});

describe('parseEmailPrefs', () => {
    it('malformed -> {}', () => {
        expect(parseEmailPrefs('{bad')).toEqual({});
        expect(parseEmailPrefs(null)).toEqual({});
        expect(parseEmailPrefs(undefined)).toEqual({});
        expect(parseEmailPrefs('[1]')).toEqual({});
        expect(parseEmailPrefs('"x"')).toEqual({});
    });
    it('drops unknown keys and non-boolean values', () => {
        expect(parseEmailPrefs('{"forms":false,"bogus":false}')).toEqual({ forms: false });
        expect(parseEmailPrefs('{"forms":"no","merges":true}')).toEqual({ merges: true });
    });
});

describe('visibleCategories', () => {
    it('hides api without a key', () => {
        expect(visibleCategories(false)).not.toContain('api');
        expect(visibleCategories(false)).toHaveLength(EMAIL_CATEGORIES.length - 1);
    });
    it('shows api with a key', () => {
        expect(visibleCategories(true)).toContain('api');
    });
});

describe('emailThrottleKey', () => {
    it('merge_request is never throttled', () => expect(emailThrottleKey('merge_request')).toBeNull());
    it('pii_access_request throttles against itself only, not the rest of its always-on category', () => {
        expect(emailThrottleKey('pii_access_request')).not.toBeNull();
        expect(emailThrottleKey('pii_access_request')).not.toBe(emailThrottleKey('merge_request'));
    });
    it('other types throttle per category', () => {
        expect(emailThrottleKey('form_submission')).toBe(emailThrottleKey('contract_result'));
        expect(emailThrottleKey('form_submission')).not.toBe(emailThrottleKey('adopter_merged'));
        expect(emailThrottleKey('some_unknown_type')).toBe(emailThrottleKey('another_unknown'));
    });
});
