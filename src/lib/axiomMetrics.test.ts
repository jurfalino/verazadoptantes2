import { describe, it, expect } from 'vitest';
import { METRICS, type MetricKey } from './axiom';

describe('METRICS registry', () => {
    it('defines all six metric keys with a chart type and label key', () => {
        const keys: MetricKey[] = ['errors', 'ai_failures', 'signin_failures', 'active_rescuers', 'activity', 'imports'];
        expect(Object.keys(METRICS).sort()).toEqual([...keys].sort());
        for (const k of keys) {
            expect(METRICS[k].labelKey).toMatch(/^admin\.metric_/);
            expect(['line', 'bar']).toContain(METRICS[k].chart);
        }
    });
    it('errors metric filters on level==error', () => {
        expect(METRICS.errors.filter).toEqual({ op: '==', field: 'level', value: 'error' });
    });
});
