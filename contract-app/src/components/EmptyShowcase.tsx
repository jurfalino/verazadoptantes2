/**
 * EmptyShowcase — the "no animals available" state.
 * Designed component (not just text) per CX call. Shows an Instagram CTA
 * only when the global INSTAGRAM_URL is configured (admin/config); otherwise
 * just the friendly empty message.
 */

interface Props {
    instagramUrl?: string | null
    scopeLabel?: string  // e.g. "esta organización", "este rescatista", "la plataforma"
}

export default function EmptyShowcase({ instagramUrl, scopeLabel }: Props) {
    const where = scopeLabel || 'la plataforma'
    return (
        <div className="ps-showcase-empty">
            <div className="ps-showcase-empty__icon" aria-hidden>🐾</div>
            <h2 className="ps-showcase-empty__title">Sin animales disponibles</h2>
            <p className="ps-showcase-empty__desc">
                Por ahora no hay animales en adopción en {where}.
                {instagramUrl ? ' Seguinos en redes para enterarte cuando publiquemos.' : ''}
            </p>
            {instagramUrl && (
                <a
                    href={instagramUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ps-btn ps-btn--primary ps-showcase-empty__cta"
                >
                    Seguinos en Instagram
                </a>
            )}
        </div>
    )
}
