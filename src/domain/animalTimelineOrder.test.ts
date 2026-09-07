import { describe, it, expect } from 'vitest';
import { compareTimelineItems, type OrderableTimelineItem } from './animalTimelineOrder';

const sorted = (items: OrderableTimelineItem[]) =>
    [...items].sort(compareTimelineItems).map(i => i.kind);

describe('compareTimelineItems', () => {
    it('orders by date, newest first', () => {
        expect(sorted([
            { kind: 'created', date: 100 },
            { kind: 'adopter_event', date: 300 },
            { kind: 'placement_start', date: 200 },
        ])).toEqual(['adopter_event', 'placement_start', 'created']);
    });

    it('puts the origin BELOW a placement that starts the same instant', () => {
        // The staging repro: luni3 was registered as already adopted, so
        // animals.created_at === placements.started_at === 1778310159.
        const t = 1778310159000;
        expect(sorted([
            { kind: 'created', date: t },
            { kind: 'placement_start', date: t, placementId: 'p1' },
        ])).toEqual(['placement_start', 'created']);
    });

    it('is insertion-order independent', () => {
        const t = 1778310159000;
        expect(sorted([
            { kind: 'placement_start', date: t, placementId: 'p1' },
            { kind: 'created', date: t },
        ])).toEqual(['placement_start', 'created']);
    });

    it('ranks a same-instant event above the placement it belongs to', () => {
        const t = 5000;
        expect(sorted([
            { kind: 'created', date: t },
            { kind: 'placement_start', date: t, placementId: 'p1' },
            { kind: 'adopter_event', date: t, placementId: 'p1' },
        ])).toEqual(['adopter_event', 'placement_start', 'created']);
    });

    it('same-day handoff: the new placement starts above the old one ending', () => {
        const t = 9000;
        expect(sorted([
            { kind: 'placement_end', date: t, placementId: 'foster1' },
            { kind: 'placement_start', date: t, placementId: 'adopt1' },
        ])).toEqual(['placement_start', 'placement_end']);
    });

    it('zero-day span: the SAME placement still ends after it starts', () => {
        const t = 9000;
        expect(sorted([
            { kind: 'placement_start', date: t, placementId: 'p1' },
            { kind: 'placement_end', date: t, placementId: 'p1' },
        ])).toEqual(['placement_end', 'placement_start']);
    });

    it('treats a null date as the oldest possible', () => {
        expect(sorted([
            { kind: 'animal_event', date: null },
            { kind: 'created', date: 1 },
        ])).toEqual(['created', 'animal_event']);
    });
});
