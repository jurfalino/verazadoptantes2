import { describe, it, expect } from 'vitest';
import {
    EMAIL_CATEGORIES,
    ALWAYS_ON_CATEGORIES,
    categoryForType,
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
        ['duplicate_candidate', 'merges'],
        ['pii_access_revoked', 'contact_access'],
        ['ownership_transferred', 'profile_changes'],
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
