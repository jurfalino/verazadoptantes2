import { describe, expect, it } from 'vitest';
import { pendientesSections, sectionOf, OTHERS_SECTIONS, type SectionGroup } from './sections';

const ORDER: SectionGroup[] = ['received', 'sent', 'declined', 'pair'];
const p = (candidateId: string, group: SectionGroup) => ({ candidateId, group });

describe('pendientesSections (audit C7)', () => {
    it('a pair combined here leaves its group («Necesitan tu respuesta») for «Recién combinados», at the end', () => {
        const s = pendientesSections([p('a', 'received'), p('b', 'received'), p('c', 'pair')], [{ candidateId: 'a' }], ORDER);
        expect(s).toEqual([
            { kind: 'group', group: 'received', pairs: [p('b', 'received')] },
            { kind: 'group', group: 'pair', pairs: [p('c', 'pair')] },
            { kind: 'merged', items: [{ candidateId: 'a' }] },
        ]);
    });
    it('a group left with only combined pairs disappears (no empty heading); combined pairs gone from the list after a reload still show', () => {
        const s = pendientesSections([p('a', 'received')], [{ candidateId: 'a' }, { candidateId: 'z' }], ORDER);
        expect(s).toEqual([{ kind: 'merged', items: [{ candidateId: 'a' }, { candidateId: 'z' }] }]);
    });
    it('nothing combined: the groups in order, no merged section', () => {
        expect(pendientesSections([p('d', 'declined'), p('s', 'sent')], [], ORDER).map(x => x.kind === 'group' && x.group)).toEqual(['sent', 'declined']);
    });
});

describe('a possible duplicate deferred to an evaluation (Q6)', () => {
    it('lands in «No necesitan nada tuyo» (pair_done), after the pairs that wait and before sent', () => {
        const live = { candidateId: 'a', group: 'pair' as const, needsViewer: true };
        const deferred = { candidateId: 'b', group: 'pair' as const, needsViewer: false };
        const sent = { candidateId: 'c', group: 'sent' as const, needsViewer: false };
        const s = pendientesSections([sent, deferred, live], []);
        expect(s.map(x => x.kind === 'group' && x.group)).toEqual(['pair', 'pair_done', 'sent']);
        expect(sectionOf(deferred)).toBe('pair_done');
        expect(OTHERS_SECTIONS.has('pair_done')).toBe(true);
    });
    it('a pair with no needsViewer info keeps its own group', () => {
        expect(sectionOf({ group: 'pair' })).toBe('pair');
    });
});
