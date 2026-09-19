import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./staleDeploy', () => ({ markDeploymentStale: vi.fn() }));

import { userFacingMessage } from './errorMessage';
import { markDeploymentStale } from './staleDeploy';
import { DEPLOYMENT_SKEW_SENTINEL } from '@/domain/clientErrors';

beforeEach(() => { vi.mocked(markDeploymentStale).mockClear(); });

describe('userFacingMessage', () => {
    it('never shows the internal skew marker; flags the tab stale instead', () => {
        // ImportWizard, AdopterForm and ~20 more printed err.message, so a stale
        // tab showed users the literal text "DEPLOYMENT_SKEW".
        expect(userFacingMessage(new Error(DEPLOYMENT_SKEW_SENTINEL), 'No se pudo guardar.')).toBe('No se pudo guardar.');
        expect(markDeploymentStale).toHaveBeenCalledTimes(1);
    });

    it('passes a real error message through unchanged', () => {
        expect(userFacingMessage(new Error('El archivo está vacío'), 'fallback')).toBe('El archivo está vacío');
        expect(markDeploymentStale).not.toHaveBeenCalled();
    });

    it('falls back for non-Error throws and empty messages', () => {
        expect(userFacingMessage('boom', 'fallback')).toBe('fallback');
        expect(userFacingMessage(new Error(''), 'fallback')).toBe('fallback');
        expect(userFacingMessage(undefined, 'fallback')).toBe('fallback');
    });
});

describe('handledAsStale', () => {
    it('recognises a stale tab and raises the notice', async () => {
        const { handledAsStale } = await import('./errorMessage');
        expect(handledAsStale(new Error(DEPLOYMENT_SKEW_SENTINEL))).toBe(true);
        expect(markDeploymentStale).toHaveBeenCalledTimes(1);
    });
    it('leaves real errors to the handler', async () => {
        const { handledAsStale } = await import('./errorMessage');
        expect(handledAsStale(new Error('boom'))).toBe(false);
        expect(markDeploymentStale).not.toHaveBeenCalled();
    });
});
