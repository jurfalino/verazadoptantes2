import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LineChart } from './LineChart';
import { BarChart } from './BarChart';

const pts = [{ t: 1, value: 0 }, { t: 2, value: 5 }, { t: 3, value: 2 }];

describe('charts', () => {
    it('LineChart renders a polyline with one coord pair per point and no NaN', () => {
        const html = renderToStaticMarkup(<LineChart points={pts} />);
        expect(html).toContain('<polyline');
        expect(html).not.toContain('NaN');
        expect((html.match(/,/g) || []).length).toBeGreaterThanOrEqual(pts.length);
    });
    it('BarChart renders one rect per point', () => {
        const html = renderToStaticMarkup(<BarChart points={pts} />);
        expect((html.match(/<rect/g) || []).length).toBe(pts.length);
    });
    it('all-zero series renders without NaN', () => {
        const zero = [{ t: 1, value: 0 }, { t: 2, value: 0 }];
        expect(renderToStaticMarkup(<LineChart points={zero} />)).not.toContain('NaN');
        expect(renderToStaticMarkup(<BarChart points={zero} />)).not.toContain('NaN');
    });
});
