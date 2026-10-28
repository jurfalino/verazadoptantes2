import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BreakableEmail } from './BreakableEmail';

describe('BreakableEmail', () => {
    it('offers a break before the @ and before each dot of the domain, and keeps the address intact', () => {
        const html = renderToStaticMarkup(<BreakableEmail email="audit-x-1793155511091@mail.example.com" />);
        expect(html).toContain('audit-x-1793155511091<wbr/>@mail<wbr/>.example<wbr/>.com');
        expect(html.replace(/<[^>]+>/g, '')).toBe('audit-x-1793155511091@mail.example.com');
        expect(html).toContain('[overflow-wrap:anywhere]');
    });
    it('a value without @ is shown as is', () => {
        expect(renderToStaticMarkup(<BreakableEmail email="anonymous" />).replace(/<[^>]+>/g, '')).toBe('anonymous');
    });
});
