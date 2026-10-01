import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/context/LanguageContext', () => ({
    useLanguage: () => ({ t: (k: string) => k }),
}));

import NotFoundView from './NotFoundView';

describe('NotFoundView', () => {
    it('renders the dog variant with its copy and a home link', () => {
        const html = renderToStaticMarkup(<NotFoundView variant="dog" />);
        expect(html).toContain('data-variant="dog"');
        expect(html).toContain('notFound.dog_title');
        expect(html).toContain('href="/"');
        expect(html).toContain('notFound.back');
    });
    it('renders the cat variant', () => {
        const html = renderToStaticMarkup(<NotFoundView variant="cat" />);
        expect(html).toContain('data-variant="cat"');
        expect(html).toContain('notFound.cat_title');
        expect(html).not.toContain('notFound.dog_title');
    });
});
