'use client';

import { useRef, useCallback, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';

export default function VerifiedBadge({ orgName, orgId }: { orgName: string; orgId: string }) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [downloaded, setDownloaded] = useState(false);

    const badgeUrl = `https://buenadoptante.org/api/badge/${orgId}`;

    const drawBadge = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const w = 320, h = 100;
        canvas.width = w;
        canvas.height = h;

        // Background — brand gradient (immutable across themes, it's an image asset)
        const grad = ctx.createLinearGradient(0, 0, w, 0);
        grad.addColorStop(0, '#0d9488');
        grad.addColorStop(1, '#0f766e');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.roundRect(0, 0, w, h, 12);
        ctx.fill();

        // Shield icon (simplified paw)
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.beginPath();
        ctx.arc(40, 50, 24, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = '28px sans-serif';
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.fillText('🛡️', 40, 60);

        // Text
        ctx.textAlign = 'left';
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 16px -apple-system, system-ui, sans-serif';
        ctx.fillText('✅ Registro Verificado', 76, 38);
        ctx.font = '13px -apple-system, system-ui, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillText(orgName.length > 28 ? orgName.slice(0, 26) + '…' : orgName, 76, 58);
        ctx.font = '11px -apple-system, system-ui, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.fillText('buenadoptante.org', 76, 78);
    }, [orgName]);

    // Draw on mount
    const canvasCallback = useCallback((node: HTMLCanvasElement | null) => {
        if (node) {
            (canvasRef as React.MutableRefObject<HTMLCanvasElement>).current = node;
            setTimeout(drawBadge, 50);
        }
    }, [drawBadge]);

    const handleCopyLink = async () => {
        try {
            await navigator.clipboard.writeText(badgeUrl);
        } catch {
            const ta = document.createElement('textarea');
            ta.value = badgeUrl;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        }
        toast.success(t('badge.link_copied'));
    };

    const handleDownload = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const link = document.createElement('a');
        link.download = `badge-${orgName.replace(/\s+/g, '-').toLowerCase()}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
        setDownloaded(true);
        setTimeout(() => setDownloaded(false), 2000);
    };

    return (
        <div className="verified-badge-card">
            <h3 className="verified-badge-heading">
                📛 {t('badge.title')}
            </h3>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.75rem' }}>
                <canvas ref={canvasCallback} className="verified-badge-canvas" style={{ width: 320, height: 100 }} />
            </div>
            <div className="verified-badge-actions">
                <button onClick={handleCopyLink} className="verified-badge-btn">
                    📋 {t('badge.copy_link')}
                </button>
                <button onClick={handleDownload} className="verified-badge-btn">
                    {downloaded ? '✓' : '⬇️'} {t('badge.download')}
                </button>
            </div>
            <p className="verified-badge-hint">
                {t('badge.hint')}
            </p>

            <style>{`
                .verified-badge-card {
                    background: var(--surface-card);
                    border-radius: 0.75rem;
                    border: 1px solid var(--border-default);
                    padding: 1rem;
                    box-shadow: 0 1px 3px var(--shadow-color);
                }
                .verified-badge-heading {
                    font-size: 0.875rem;
                    font-weight: 600;
                    color: var(--text-secondary);
                    margin: 0 0 0.75rem;
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                }
                .verified-badge-canvas {
                    border-radius: 0.5rem;
                    max-width: 100%;
                }
                .verified-badge-actions {
                    display: flex;
                    gap: 0.5rem;
                    justify-content: center;
                }
                .verified-badge-btn {
                    padding: 0.375rem 0.75rem;
                    font-size: 0.75rem;
                    font-weight: 500;
                    color: var(--accent);
                    background: var(--accent-subtle-bg);
                    border: 1px solid var(--border-accent);
                    border-radius: 0.5rem;
                    cursor: pointer;
                    transition: background 0.2s;
                }
                .verified-badge-btn:hover {
                    background: var(--accent-badge-bg);
                }
                .verified-badge-hint {
                    font-size: 0.75rem;
                    color: var(--text-faint);
                    text-align: center;
                    margin: 0.5rem 0 0;
                }
            `}</style>
        </div>
    );
}
