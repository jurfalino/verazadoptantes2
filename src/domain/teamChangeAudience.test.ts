import { describe, it, expect } from 'vitest';
import { parseProfileChangesFrom, hearsChange } from './teamChangeAudience';

describe('parseProfileChangesFrom', () => {
    it('nothing stored, or anything unknown: «Otros rescatistas» (the default, Jon 2026-11-08)', () => {
        expect(parseProfileChangesFrom(null)).toBe('outside');
        expect(parseProfileChangesFrom(undefined)).toBe('outside');
        expect(parseProfileChangesFrom('')).toBe('outside');
        expect(parseProfileChangesFrom('everyone')).toBe('outside');
    });
    it('«Otros rescatistas y mi equipo» is kept', () => {
        expect(parseProfileChangesFrom('team')).toBe('team');
        expect(parseProfileChangesFrom('outside')).toBe('outside');
    });
});

describe('hearsChange', () => {
    it('a change by someone outside my team always notifies me', () => {
        expect(hearsChange({ recipient: 'me@x.org', actor: 'out@y.org', actorIsTeammate: false, from: 'outside' })).toBe(true);
        expect(hearsChange({ recipient: 'me@x.org', actor: 'out@y.org', actorIsTeammate: false, from: 'team' })).toBe(true);
    });
    it('a teammate\'s change notifies me only when I chose «… y mi equipo»', () => {
        expect(hearsChange({ recipient: 'me@x.org', actor: 'mate@x.org', actorIsTeammate: true, from: 'outside' })).toBe(false);
        expect(hearsChange({ recipient: 'me@x.org', actor: 'mate@x.org', actorIsTeammate: true, from: 'team' })).toBe(true);
    });
    it('my own change never notifies me, whatever I chose (case-insensitive)', () => {
        expect(hearsChange({ recipient: 'Me@X.org ', actor: 'me@x.org', actorIsTeammate: false, from: 'team' })).toBe(false);
    });
});
