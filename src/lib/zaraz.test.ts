import { describe, it, expect, vi, beforeEach } from 'vitest';

const posthogMock = vi.hoisted(() => ({ __loaded: false, capture: vi.fn() }));
vi.mock('posthog-js', () => ({ default: posthogMock }));

// The queue is module state, so each test loads a fresh copy.
async function loadZaraz() {
    vi.resetModules();
    return import('./zaraz');
}

describe('PostHog mirroring in zarazTrack', () => {
    beforeEach(() => {
        posthogMock.__loaded = false;
        posthogMock.capture.mockClear();
        vi.stubGlobal('window', {});
    });

    it('holds events fired before PostHog loads and sends them on flush, in order', async () => {
        const { zarazTrack, flushPostHogQueue } = await loadZaraz();
        zarazTrack('signed_in', { role: 'viewer' });
        zarazTrack('search_performed', { resultCount: 2 });
        expect(posthogMock.capture).not.toHaveBeenCalled();

        posthogMock.__loaded = true;
        flushPostHogQueue();
        expect(posthogMock.capture.mock.calls).toEqual([
            ['signed_in', { role: 'viewer' }],
            ['search_performed', { resultCount: 2 }],
        ]);
    });

    it('sends straight through once PostHog is loaded', async () => {
        const { zarazTrack } = await loadZaraz();
        posthogMock.__loaded = true;
        zarazTrack('adopter_updated', { source: 'form' });
        expect(posthogMock.capture).toHaveBeenCalledWith('adopter_updated', { source: 'form' });
    });

    it('caps the queue so a disabled PostHog cannot grow it forever', async () => {
        const { posthogTrack, flushPostHogQueue } = await loadZaraz();
        for (let i = 0; i < 80; i++) posthogTrack('search_performed');
        flushPostHogQueue();
        expect(posthogMock.capture).toHaveBeenCalledTimes(50);
    });

    it('does nothing on the server', async () => {
        vi.unstubAllGlobals();
        const { posthogTrack, flushPostHogQueue } = await loadZaraz();
        posthogTrack('search_performed');
        flushPostHogQueue();
        expect(posthogMock.capture).not.toHaveBeenCalled();
    });
});
