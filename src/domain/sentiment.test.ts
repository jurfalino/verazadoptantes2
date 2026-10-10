import { describe, it, expect } from 'vitest';
import { scoreNoteSentiment, classifyRatingsAudit } from './sentiment';

const queue = (rating: number, text: string) => classifyRatingsAudit(rating, scoreNoteSentiment(text));

// Synthetic notes shaped like the production rows that were wrongly offered as
// "subir calificación" on 2026-10-09 — every one was a warning post.
describe('classifyRatingsAudit — upgrade never fires on warning posts', () => {
    it('con-artist praise followed by theft (the same adopter was also in to_one)', () => {
        expect(queue(1, 'Se hace pasar por proteccionista, tiene buena dicción, te ofrece ayuda y con eso genera confianza, ya ha robado y desaparecido perros.')).not.toBe('upgrade');
    });

    it('"parecía responsable… pero" with the animals stolen and lost', () => {
        expect(queue(2, 'Parecía responsable, le daba muy buen alimento, todo súper bien. Pero después me dice que le entraron a robar y se perdieron sus gatos.')).not.toBe('upgrade');
    });

    it('explicit "do not give" request', () => {
        expect(queue(2, 'Por favor no entregar en adopción!! Buenas tardes, tengo en adopción responsable un bebé, les pido que no le entreguen nada.')).not.toBe('upgrade');
    });

    it('cruelty spelled with digits to dodge filters', () => {
        expect(queue(1, 'ATENCIÓN: sigue pidiendo animales en adopción para mutil4r, tortur4r y mat4r. Muy buena presencia, ayuda en refugios.')).not.toBe('upgrade');
    });

    it('refuses the sterilization commitment', () => {
        expect(queue(2, 'Quiere cachorra pero no quiere compromiso de castración.')).not.toBe('upgrade');
    });

    it('two mild negatives veto even when praise outweighs them', () => {
        expect(queue(2, 'Muy buena persona, excelente trato, pero ojo: mal cuidado del patio.')).not.toBe('upgrade');
    });
});

describe('classifyRatingsAudit — upgrade still catches real mis-ratings', () => {
    it('genuine follow-up praise rated 2 (the past real catch)', () => {
        expect(queue(2, 'Se entregó con compromiso de castración!! Todo muy bien con la adoptante, siempre nos manda fotos.')).toBe('upgrade');
    });

    it('one mild ambiguous word does not veto', () => {
        expect(queue(2, 'Excelente adoptante, el gato tiene un solo ojo y está feliz.')).toBe('upgrade');
    });
});

describe('scoreNoteSentiment', () => {
    it('reports negative evidence separately from the net score', () => {
        const s = scoreNoteSentiment('Tiene buena dicción, te ofrece ayuda, ya ha robado perros.');
        expect(s.negative).toBeLessThanOrEqual(-2);
    });

    it('leaves standalone numbers alone when undoing digit spelling', () => {
        expect(scoreNoteSentiment('Tiene 3 perros y 4 gatos, muy buena adoptante.').negative).toBe(0);
    });

    it('new warning wording lands strong negatives in to_one', () => {
        expect(queue(2, 'No entregar gatitos.')).toBe('to_one');
        expect(queue(2, 'Alquila, es irresponsable.')).toBe('to_one');
    });
});
