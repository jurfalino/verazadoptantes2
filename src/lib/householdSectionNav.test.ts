/**
 * Getting to «Familiares / Convivientes» (re-review M-d, item 1): the header
 * chip's link moves focus to the heading; arriving from /my-adopters with the
 * anchor scrolls there and focuses the heading once.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { followHouseholdSectionHash, goToHouseholdSection } from './householdSectionNav';
import { HOUSEHOLD_SECTION_HEADING_ID, HOUSEHOLD_SECTION_HREF, HOUSEHOLD_SECTION_ID } from '@/domain/profileHouseholds';

function page(withSection = true) {
    const section = { scrollIntoView: vi.fn() };
    const heading = { focus: vi.fn() };
    const doc = {
        getElementById: (id: string) => (withSection ? ({ [HOUSEHOLD_SECTION_ID]: section, [HOUSEHOLD_SECTION_HEADING_ID]: heading } as Record<string, unknown>)[id] ?? null : null),
    } as unknown as Pick<Document, 'getElementById'>;
    return { section, heading, doc };
}

function win(hash: string, doc: Pick<Document, 'getElementById'>) {
    const listeners = new Map<string, () => void>();
    return {
        listeners,
        w: {
            location: { hash },
            document: doc,
            addEventListener: vi.fn((ev: string, fn: () => void) => { listeners.set(ev, fn); }),
            removeEventListener: vi.fn((ev: string) => { listeners.delete(ev); }),
            setTimeout: ((fn: () => void, ms: number) => setTimeout(fn, ms)) as unknown as Window['setTimeout'],
            clearTimeout: ((id: number) => clearTimeout(id)) as unknown as Window['clearTimeout'],
        },
    };
}

afterEach(() => { vi.useRealTimers(); });

describe('goToHouseholdSection — the profile header chip (a link)', () => {
    it('smooth-scrolls to the section and moves focus to its heading without a second scroll', () => {
        const { section, heading, doc } = page();
        expect(goToHouseholdSection(doc, { smooth: true })).toBe(true);
        expect(section.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
        expect(heading.focus).toHaveBeenCalledWith({ preventScroll: true });
    });

    it('no section on the page → false, so the link jumps by itself', () => {
        expect(goToHouseholdSection(page(false).doc, { smooth: true })).toBe(false);
    });

    it('the shared href points at the shared id', () => {
        expect(HOUSEHOLD_SECTION_HREF).toBe(`#${HOUSEHOLD_SECTION_ID}`);
    });
});

describe('followHouseholdSectionHash — arriving from a /my-adopters chip', () => {
    it('with the anchor: scrolls there while the page settles and focuses the heading once', () => {
        vi.useFakeTimers();
        const { section, heading, doc } = page();
        const { w } = win(HOUSEHOLD_SECTION_HREF, doc);
        const cleanup = followHouseholdSectionHash(w);
        vi.advanceTimersByTime(2000);
        expect(section.scrollIntoView).toHaveBeenCalledTimes(4);
        expect(section.scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
        expect(heading.focus).toHaveBeenCalledTimes(1);
        expect(heading.focus).toHaveBeenCalledWith({ preventScroll: true });
        cleanup();
    });

    it('stops as soon as the person scrolls, touches or types', () => {
        vi.useFakeTimers();
        const { section, doc } = page();
        const { w, listeners } = win(HOUSEHOLD_SECTION_HREF, doc);
        followHouseholdSectionHash(w);
        expect([...listeners.keys()].sort()).toEqual(['keydown', 'touchstart', 'wheel']);
        vi.advanceTimersByTime(0);
        listeners.get('keydown')!();
        vi.advanceTimersByTime(2000);
        expect(section.scrollIntoView).toHaveBeenCalledTimes(1);
    });

    it('without the anchor: nothing at all; cleanup clears the timers and listeners', () => {
        vi.useFakeTimers();
        const { section, doc } = page();
        const none = win('', doc);
        followHouseholdSectionHash(none.w)();
        expect(none.w.addEventListener).not.toHaveBeenCalled();
        const some = win(HOUSEHOLD_SECTION_HREF, doc);
        followHouseholdSectionHash(some.w)();
        vi.advanceTimersByTime(2000);
        expect(section.scrollIntoView).not.toHaveBeenCalled();
        expect(some.listeners.size).toBe(0);
    });
});
