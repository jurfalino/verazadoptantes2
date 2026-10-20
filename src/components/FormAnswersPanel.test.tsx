import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/context/LanguageContext', () => ({
    useLanguage: () => ({ t: (k: string) => k }),
}));

import { AnswerRow, AnswerValue, withBreaks, emailWithBreaks } from './FormAnswersPanel';

const html = (node: React.ReactNode) => renderToStaticMarkup(<>{node}</>);

// Reel 06: a long label squeezed its value until «No» broke into «N / o».
describe('answer rows', () => {
    it('every row is the same two-column grid: label track wraps, value never breaks a short word', () => {
        const out = html(<AnswerRow label="Compromiso de castración/esterilización">No</AnswerRow>);
        expect(out).toContain('grid-cols-[minmax(0,2fr)_minmax(0,3fr)]');
        expect(out).toContain('@md:grid-cols-[14rem_minmax(0,1fr)]');
        expect(out).toContain('@container');
        expect(out).not.toContain('overflow-wrap:anywhere');
        expect(out).toContain('castración/<wbr/>esterilización:');
    });

    it('an email breaks after «@» (and the dots before it), never inside the domain', () => {
        expect(html(emailWithBreaks('diego.ruiz@ejemplo.com.ar'))).toBe('diego.<wbr/>ruiz@<wbr/>ejemplo.com.ar');
        expect(html(emailWithBreaks('sin-arroba'))).toBe('sin-arroba');
    });

    it('withBreaks adds no break at the very end', () => {
        expect(html(withBreaks('a/b/', '/'))).toBe('a/<wbr/>b/');
        expect(withBreaks('plain', '/')).toBe('plain');
    });

    it('a handle that is an email gets the email breaks; a link breaks at «/» and «.»', () => {
        expect(html(<AnswerValue field="instagram" raw="x" display="diego@ejemplo.com" />)).toContain('diego@<wbr/>ejemplo.com');
        expect(html(<AnswerValue field="facebook" raw="x" display="fb.com/diego" />)).toContain('fb.<wbr/>com/<wbr/>diego');
        expect(html(<AnswerValue field="motivation" raw="x" display="a.b/c" />)).not.toContain('<wbr/>');
    });
});
