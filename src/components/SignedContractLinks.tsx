'use client';

import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';

/**
 * H1: the signed contract's two buttons, named by what they open — the same
 * pair, labels and look on every surface that shows a signed contract (the
 * profile record, the animal timeline, «Mis animales», «Mis adopciones», the
 * record's edit form):
 *
 *   - «Contrato firmado (PDF)»: the file (new tab).
 *   - «Datos y posibles duplicados»: what the adopter typed and who it may
 *     match (/contract-results/<signedContractId>). No count on it: the
 *     profile's «Posible duplicado de … · Revisar» bar already shows them.
 *     Only when the record has a signed_contracts row (`resultsHref`); an
 *     older contract shows the PDF alone.
 *
 * Both stop the click from reaching a clickable card (which opens the editor).
 */
export default function SignedContractLinks({ pdfHref, resultsHref, className = '' }: {
    pdfHref: string;
    resultsHref?: string | null;
    className?: string;
}) {
    const { t } = useLanguage();
    const pdfLabel = t('dashboard.view_signed_contract');
    const resultsLabel = t('dashboard.contract_results_link');
    const base = 'inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold min-h-[44px] md:min-h-0 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-1';
    return (
        <div className={`flex flex-wrap items-center gap-2 ${className}`} data-testid="signed-contract-links">
            <a
                href={pdfHref}
                target="_blank"
                rel="noopener noreferrer"
                title={pdfLabel}
                data-testid="signed-contract-pdf"
                className={`${base} border border-stone-200 bg-white text-teal-700 hover:bg-stone-50`}
                onClick={e => e.stopPropagation()}
            >
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>
                <span>{pdfLabel}</span>
            </a>
            {resultsHref && (
                <Link
                    href={resultsHref}
                    title={resultsLabel}
                    data-testid="signed-contract-results"
                    className={`${base} border border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100`}
                    onClick={e => e.stopPropagation()}
                >
                    {resultsLabel}
                </Link>
            )}
        </div>
    );
}
