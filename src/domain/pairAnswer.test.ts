import { describe, it, expect } from 'vitest';
import { mayAnswerPair } from './pairAnswer';

const TEAM = new Set(['me@example.com', 'mate@example.com']);

describe('mayAnswerPair — the team acts as one (step 2, Jon 2026-11-05)', () => {
    it('a side the viewer loaded', () => {
        expect(mayAnswerPair(TEAM, 'me@example.com', 'other@example.com')).toBe(true);
    });
    it('a side a teammate loaded', () => {
        expect(mayAnswerPair(TEAM, 'other@example.com', 'mate@example.com')).toBe(true);
    });
    it('an owner stored with capitals or spaces still counts', () => {
        expect(mayAnswerPair(TEAM, ' Mate@Example.com ', null)).toBe(true);
    });
    it('neither side the team’s: no', () => {
        expect(mayAnswerPair(TEAM, 'other@example.com', 'stranger@example.com')).toBe(false);
    });
    it('no owner, anonymous or empty never count, even with an odd team', () => {
        expect(mayAnswerPair(new Set(['anonymous', '']), 'anonymous', '', null, undefined)).toBe(false);
    });
    it('an empty team answers nothing', () => {
        expect(mayAnswerPair(new Set(), 'me@example.com')).toBe(false);
    });
});
