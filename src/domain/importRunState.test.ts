import { describe, it, expect } from 'vitest';
import { importRunState, IMPORT_RUN_IDLE_SECS } from './importRunState';

const now = 1_800_000_000;

describe('importRunState', () => {
    it('a finished run is completed', () => {
        expect(importRunState({ finishedAt: now - 10_000, lastItemAt: now - 10_000 }, now)).toBe('completed');
    });

    it('recent row activity is running; stale activity is interrupted', () => {
        expect(importRunState({ lastItemAt: now - 30 }, now)).toBe('running');
        expect(importRunState({ lastItemAt: now - IMPORT_RUN_IDLE_SECS - 1 }, now)).toBe('interrupted');
    });

    it('a run that never saved a row is timed from its start, not «en curso» forever', () => {
        expect(importRunState({ lastItemAt: null, startedAt: new Date((now - 3600) * 1000) }, now)).toBe('interrupted');
        expect(importRunState({ lastItemAt: null, startedAt: new Date((now - 20) * 1000) }, now)).toBe('running');
    });

    it('reads epoch seconds, epoch ms and ISO strings for the start', () => {
        expect(importRunState({ startedAt: now - 3600 }, now)).toBe('interrupted');
        expect(importRunState({ startedAt: (now - 3600) * 1000 }, now)).toBe('interrupted');
        expect(importRunState({ startedAt: new Date((now - 3600) * 1000).toISOString() }, now)).toBe('interrupted');
    });

    it('with no timestamps at all it stays running (nothing to judge by)', () => {
        expect(importRunState({}, now)).toBe('running');
    });
});
