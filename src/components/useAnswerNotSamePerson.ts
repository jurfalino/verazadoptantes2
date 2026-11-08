'use client';

import { useRouter } from 'next/navigation';
import { dismissDuplicateCandidate } from '@/app/actions/duplicates';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { handledAsStale } from '@/lib/errorMessage';

/**
 * «No es esta persona» on a form or contract card: the same answer as
 * «Mantener separados» in «Pendientes de revisar» — the pair is dismissed for
 * everyone (spec 2026-11-05) — with the same outcomes the list shows. Resolves
 * true when the pair is no longer open (answered now, or already by someone).
 */
export function useAnswerNotSamePerson(source: string) {
    const router = useRouter();
    const toast = useShowToast();
    const { t } = useLanguage();
    return async (candidateId: string): Promise<boolean> => {
        try {
            const result = await dismissDuplicateCandidate(candidateId);
            if (result?.success) { router.refresh(); return true; }
            // Settled elsewhere after the page loaded — what the rescuer wanted: refresh, don't alarm.
            if (result?.code === 'already_resolved' || result?.code === 'not_found') {
                toast.success(t('common.updated') || 'Actualizado', result.code === 'already_resolved' ? t('errors.dedup_already_resolved') : t('errors.dedup_not_found'));
                router.refresh();
                return true;
            }
            const message = result?.code === 'not_authorized' ? t('errors.dedup_not_authorized') : t('errors.dedup_dismiss_failed');
            toast.error(t('errors.generic') || 'Error', message, resolveErrorId(new Error(`dismissDuplicateCandidate: ${result?.code ?? 'failed'}`), source));
            return false;
        } catch (e) {
            if (handledAsStale(e)) return false;
            toast.error(t('errors.generic') || 'Error', t('errors.dedup_dismiss_failed'), resolveErrorId(e, source));
            return false;
        }
    };
}
