/**
 * The group chip («michis», «Asociación …») on the homepage rows and the
 * /my-adopters provenance line — ONE look on both (home-cards review 2026-11-07).
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GroupChip } from './GroupChip';

describe('GroupChip', () => {
    it('carries a border, so the pill stays visible where its fill equals the card (dark theme)', () => {
        expect(renderToStaticMarkup(<GroupChip name="michis" self />)).toMatch(/\bborder\b/);
        expect(renderToStaticMarkup(<GroupChip name="michis" self={false} />)).toMatch(/\bborder\b/);
    });

    it('a long name is cut to one line, with the whole name on hover', () => {
        const long = 'Asociación Protectora de Animales Abandonados del Gran Buenos Aires';
        const html = renderToStaticMarkup(<GroupChip name={long} self={false} />);
        expect(html).toContain(`title="${long}"`);
        expect(html).toMatch(/max-w-\[10rem\]/);
        expect(html).toMatch(/class="truncate"/);
    });

    it('can shrink below its 10rem cap in a narrow row (a 360px phone with the rating column) instead of pushing the card wider', () => {
        expect(renderToStaticMarkup(<GroupChip name="Asociación Protectora" self={false} />)).toMatch(/\bmin-w-0\b/);
    });

    it('is the 22px pill box of the rating badge (11px text, 16px line)', () => {
        const html = renderToStaticMarkup(<GroupChip name="michis" self />);
        expect(html).toMatch(/text-\[11px\]/);
        expect(html).toMatch(/leading-4/);
        expect(html).toMatch(/py-0\.5/);
    });

    it('stone for your own group, teal for a teammate\'s', () => {
        expect(renderToStaticMarkup(<GroupChip name="a" self />)).toMatch(/bg-stone-100/);
        expect(renderToStaticMarkup(<GroupChip name="a" self={false} />)).toMatch(/bg-teal-50/);
    });
});
