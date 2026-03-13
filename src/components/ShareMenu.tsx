'use client';

import { useState } from 'react';

interface ShareMenuProps {
    contractUrl: string; // animal ID or path like /contract/{id}
    animalName: string;
}

// External contract app domain — no buenadoptante branding
const CONTRACT_BASE = (process.env.NEXT_PUBLIC_CONTRACT_URL || 'https://adoptions.pages.dev').replace(/\/+$/, '');

export default function ShareMenu({ contractUrl, animalName }: ShareMenuProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [copied, setCopied] = useState(false);

    // Extract just the ID from the contractUrl (handles both "/contract/abc" and "abc")
    const animalId = contractUrl.replace(/^\/contract\//, '');
    const fullUrl = `${CONTRACT_BASE}/${animalId}`;

    const shareText = `Contrato de adopción para ${animalName}`;

    const handleCopyLink = async () => {
        try {
            await navigator.clipboard.writeText(fullUrl);
        } catch {
            const textarea = document.createElement('textarea');
            textarea.value = fullUrl;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleWhatsApp = () => {
        window.open(`https://wa.me/?text=${encodeURIComponent(`${shareText}\n${fullUrl}`)}`, '_blank');
        setIsOpen(false);
    };

    const handleEmail = () => {
        window.open(`mailto:?subject=${encodeURIComponent(shareText)}&body=${encodeURIComponent(`${shareText}\n\n${fullUrl}`)}`, '_blank');
        setIsOpen(false);
    };

    const handleNativeShare = async () => {
        if (navigator.share) {
            try {
                await navigator.share({ title: shareText, url: fullUrl });
            } catch { /* User cancelled */ }
        }
        setIsOpen(false);
    };

    return (
        <>
            <button
                onClick={(e) => { e.stopPropagation(); e.preventDefault(); setIsOpen(true); }}
                className="inline-flex items-center gap-2 px-4 py-2.5 text-[13px] font-semibold text-teal-700 bg-teal-50 rounded-xl hover:bg-teal-100 transition-colors border border-teal-200"
                title="Share adoption contract"
            >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
                Contrato
            </button>

            {/* Centered Modal Overlay */}
            {isOpen && (
                <div
                    className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200"
                    onClick={() => setIsOpen(false)}
                >
                    {/* Backdrop */}
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

                    {/* Modal */}
                    <div
                        className="relative bg-white rounded-2xl shadow-2xl border border-stone-200 w-full max-w-sm animate-in zoom-in-95 slide-in-from-bottom-4 duration-300"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="p-5 pb-3 border-b border-stone-100">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-teal-100 flex items-center justify-center text-lg">📋</div>
                                    <div>
                                        <h3 className="font-semibold text-stone-900 text-sm">Enviar Contrato</h3>
                                        <p className="text-xs text-stone-500 mt-0.5 truncate max-w-[180px]">{animalName}</p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setIsOpen(false)}
                                    className="w-8 h-8 rounded-full flex items-center justify-center text-stone-500 hover:bg-stone-100 hover:text-stone-600 transition-colors"
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                </button>
                            </div>
                        </div>

                        {/* Share Options */}
                        <div className="p-3 space-y-1">
                            <a
                                href={fullUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={() => setIsOpen(false)}
                                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left hover:bg-stone-50 active:bg-stone-100 transition-colors"
                            >
                                <div className="w-10 h-10 rounded-xl bg-teal-100 flex items-center justify-center flex-shrink-0 text-teal-700">
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                                </div>
                                <div>
                                    <p className="text-sm font-semibold text-stone-900">Abrir en nueva pestaña</p>
                                    <p className="text-xs text-stone-500">Ver el contrato como lo verá el adoptante</p>
                                </div>
                            </a>

                            <button
                                onClick={handleCopyLink}
                                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left hover:bg-stone-50 active:bg-stone-100 transition-colors"
                            >
                                <div className="w-10 h-10 rounded-xl bg-stone-100 flex items-center justify-center text-lg flex-shrink-0">
                                    {copied ? '✅' : '🔗'}
                                </div>
                                <div>
                                    <p className="text-sm font-semibold text-stone-900">{copied ? '¡Copiado!' : 'Copiar enlace'}</p>
                                    <p className="text-xs text-stone-500 truncate max-w-[220px]">{fullUrl}</p>
                                </div>
                            </button>

                            <button
                                onClick={handleWhatsApp}
                                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left hover:bg-green-50 active:bg-green-100 transition-colors"
                            >
                                <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center text-lg flex-shrink-0">💬</div>
                                <div>
                                    <p className="text-sm font-semibold text-stone-900">WhatsApp</p>
                                    <p className="text-xs text-stone-500">Enviar por mensaje</p>
                                </div>
                            </button>

                            <button
                                onClick={handleEmail}
                                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left hover:bg-blue-50 active:bg-blue-100 transition-colors"
                            >
                                <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center text-lg flex-shrink-0">📧</div>
                                <div>
                                    <p className="text-sm font-semibold text-stone-900">Email</p>
                                    <p className="text-xs text-stone-500">Enviar por correo electrónico</p>
                                </div>
                            </button>

                            {typeof navigator !== 'undefined' && 'share' in navigator && (
                                <button
                                    onClick={handleNativeShare}
                                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left hover:bg-purple-50 active:bg-purple-100 transition-colors"
                                >
                                    <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center text-lg flex-shrink-0">📤</div>
                                    <div>
                                        <p className="text-sm font-semibold text-stone-900">Más opciones...</p>
                                        <p className="text-xs text-stone-500">Compartir usando apps del sistema</p>
                                    </div>
                                </button>
                            )}
                        </div>

                        {/* Footer hint */}
                        <div className="px-5 pb-4 pt-1">
                            <p className="text-xs text-stone-500 text-center">
                                El adoptante podrá completar sus datos desde el enlace del contrato
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
