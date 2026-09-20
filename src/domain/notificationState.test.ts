import { describe, it, expect } from 'vitest';
import { notificationSeenState, summariseSeen } from './notificationState';

describe('notificationSeenState — did the recipient actually see it?', () => {
    it('is unseen until the recipient opens or dismisses it', () => {
        expect(notificationSeenState({ read: 0, dismissed: 0 })).toBe('unseen');
    });
    it('is seen once read', () => {
        expect(notificationSeenState({ read: 1, dismissed: 0 })).toBe('seen');
    });
    it('dismissed without opening still means it was looked at, and says so', () => {
        expect(notificationSeenState({ read: 0, dismissed: 1 })).toBe('dismissed');
    });
    it('read and later dismissed reads as seen: the stronger fact wins', () => {
        expect(notificationSeenState({ read: 1, dismissed: 1 })).toBe('seen');
    });
    it('tolerates the shapes D1 hands back', () => {
        expect(notificationSeenState({ read: true, dismissed: null })).toBe('seen');
        expect(notificationSeenState({ read: '1', dismissed: undefined })).toBe('seen');
        expect(notificationSeenState({ read: null, dismissed: null })).toBe('unseen');
    });
});

describe('summariseSeen', () => {
    it('counts each state', () => {
        expect(summariseSeen([
            { read: 1, dismissed: 0 }, { read: 0, dismissed: 0 }, { read: 0, dismissed: 1 }, { read: 0, dismissed: 0 },
        ])).toEqual({ seen: 1, dismissed: 1, unseen: 2 });
    });
});
