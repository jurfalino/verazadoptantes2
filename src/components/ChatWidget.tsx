'use client';

/**
 * Floating support chat widget.
 *
 * Mounted once at the root layout, gated by the ENABLE_CHAT_WIDGET flag.
 * Holds a per-browser conversationId in localStorage; sends visitor
 * messages to /api/chat (which forwards to admin's Telegram); short-polls
 * /api/chat for admin replies while the panel is open AND the tab is
 * visible. Closes silently otherwise — no background traffic.
 *
 * Theme: uses CSS variables only (`--surface-card`, `--accent`,
 * `--text-primary`, etc.) so it inherits whichever palette is active under
 * `[data-theme]`. Z-index `z-[80]` so it sits below toasts (`z-[100]`).
 *
 * Privacy: outbound traffic only goes to the same origin (`/api/chat`).
 * Open the Network tab to confirm no `t.me` / `telegram.org` host is hit
 * from the browser — the relay is server-side only.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useLanguage } from '@/context/LanguageContext';

const SESSION_KEY = 'chat_session_id';
const LAST_SEEN_KEY = 'chat_last_seen_at';
const POLL_INTERVAL_MS = 4_000;

interface ChatMessage {
    id: string;
    direction: 'user' | 'admin';
    body: string;
    createdAt: number;
}

function getOrCreateSessionId(): string {
    if (typeof window === 'undefined') return '';
    try {
        const existing = localStorage.getItem(SESSION_KEY);
        if (existing && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(existing)) {
            return existing;
        }
        const fresh = crypto.randomUUID();
        localStorage.setItem(SESSION_KEY, fresh);
        return fresh;
    } catch {
        return crypto.randomUUID();
    }
}

export default function ChatWidget() {
    const { t, locale } = useLanguage();
    const [open, setOpen] = useState(false);
    const [sessionId, setSessionId] = useState<string>('');
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [hasUnread, setHasUnread] = useState(false);
    const [honeypot, setHoneypot] = useState('');
    const lastSeenRef = useRef<number>(0);
    const messagesEndRef = useRef<HTMLDivElement | null>(null);

    // Hydrate session id + last-seen marker on mount
    useEffect(() => {
        const id = getOrCreateSessionId();
        setSessionId(id);
        try {
            const raw = localStorage.getItem(LAST_SEEN_KEY);
            if (raw) lastSeenRef.current = Number(raw) || 0;
        } catch { /* localStorage unavailable */ }
    }, []);

    // Auto-scroll to newest on each render where messages changed
    useEffect(() => {
        if (open && messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
    }, [messages, open]);

    const persistLastSeen = useCallback((ts: number) => {
        lastSeenRef.current = ts;
        try { localStorage.setItem(LAST_SEEN_KEY, String(ts)); } catch { /* localStorage unavailable */ }
    }, []);

    // When the panel opens, mark all current admin replies as seen so the
    // unread dot clears.
    useEffect(() => {
        if (open && messages.length > 0) {
            const newest = messages[messages.length - 1].createdAt;
            persistLastSeen(newest);
            setHasUnread(false);
        }
    }, [open, messages, persistLastSeen]);

    const fetchMessages = useCallback(async (since: number) => {
        if (!sessionId) return;
        try {
            const res = await fetch(`/api/chat?conversationId=${sessionId}&since=${since}`, {
                method: 'GET',
                cache: 'no-store',
            });
            if (!res.ok) return;
            const data = (await res.json()) as { messages?: ChatMessage[] };
            const incoming: ChatMessage[] = Array.isArray(data?.messages) ? data.messages : [];
            if (incoming.length === 0) return;
            setMessages(prev => {
                const seen = new Set(prev.map(m => m.id));
                const merged = [...prev];
                for (const m of incoming) {
                    if (!seen.has(m.id)) merged.push(m);
                }
                merged.sort((a, b) => a.createdAt - b.createdAt);
                return merged;
            });
            const newestIncoming = incoming[incoming.length - 1].createdAt;
            const adminUnread = incoming.some(m => m.direction === 'admin' && m.createdAt > lastSeenRef.current);
            if (open) {
                persistLastSeen(newestIncoming);
            } else if (adminUnread) {
                setHasUnread(true);
            }
        } catch {
            // Network blip — next tick will retry.
        }
    }, [sessionId, open, persistLastSeen]);

    // Initial fetch (load history when widget mounts so the user sees their
    // prior session on refresh).
    useEffect(() => {
        if (sessionId) {
            fetchMessages(0);
        }
    }, [sessionId, fetchMessages]);

    // Polling effect: only while open AND tab visible.
    useEffect(() => {
        if (!open || !sessionId) return;
        let cancelled = false;
        const tick = async () => {
            if (cancelled) return;
            if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
            const since = messages.length > 0 ? messages[messages.length - 1].createdAt : 0;
            await fetchMessages(since);
        };
        const handle = setInterval(tick, POLL_INTERVAL_MS);
        return () => { cancelled = true; clearInterval(handle); };
    }, [open, sessionId, messages, fetchMessages]);

    const send = useCallback(async () => {
        const body = input.trim();
        if (!body || sending || !sessionId) return;
        setSending(true);
        setError(null);
        try {
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    conversationId: sessionId,
                    body,
                    userLabel: `(${locale}) anon`,
                    companyName: honeypot,
                }),
            });
            if (!res.ok) {
                const data = (await res.json().catch(() => ({}))) as { error?: string };
                setError(typeof data?.error === 'string' ? data.error : t('chat.error_send'));
                return;
            }
            // Optimistic local insert — the server-assigned id arrives but
            // we don't strictly need it; next poll will reconcile by id.
            const localId = res.headers.get('x-chat-local-id') || `local-${Date.now()}`;
            setMessages(prev => [...prev, {
                id: localId,
                direction: 'user',
                body,
                createdAt: Date.now(),
            }]);
            setInput('');
        } catch (e) {
            setError(e instanceof Error ? e.message : t('chat.error_send'));
        } finally {
            setSending(false);
        }
    }, [input, sending, sessionId, locale, honeypot, t]);

    const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            send();
        }
    };

    return (
        <>
            {/* Floating button */}
            {!open && (
                <button
                    type="button"
                    onClick={() => setOpen(true)}
                    aria-label={t('chat.open')}
                    title={t('chat.open')}
                    className="fixed bottom-4 right-4 z-[80] inline-flex items-center justify-center w-14 h-14 rounded-full shadow-lg transition-all duration-200 hover:scale-105 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                    style={{
                        background: 'var(--accent)',
                        color: '#ffffff',
                    }}
                >
                    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                    </svg>
                    {hasUnread && (
                        <span
                            className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2"
                            style={{ background: '#ef4444', borderColor: 'var(--surface-base)' }}
                            aria-label={t('chat.unread_indicator')}
                        />
                    )}
                </button>
            )}

            {/* Panel */}
            {open && (
                <div
                    role="dialog"
                    aria-label={t('chat.title')}
                    className="fixed bottom-4 right-4 z-[80] w-[calc(100vw-2rem)] sm:w-[380px] max-h-[calc(100vh-2rem)] rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-slideDown"
                    style={{
                        background: 'var(--surface-card)',
                        border: '1px solid var(--border-default)',
                        color: 'var(--text-primary)',
                    }}
                >
                    {/* Header */}
                    <div
                        className="px-4 py-3 flex items-center justify-between gap-2"
                        style={{ background: 'var(--accent)', color: '#ffffff' }}
                    >
                        <div className="min-w-0">
                            <p className="text-sm font-semibold truncate">{t('chat.title')}</p>
                            <p className="text-xs opacity-90 truncate">{t('chat.subtitle')}</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setOpen(false)}
                            aria-label={t('chat.close')}
                            title={t('chat.close')}
                            className="shrink-0 p-1 rounded-md transition-opacity opacity-80 hover:opacity-100 focus:outline-none focus-visible:opacity-100"
                            style={{ color: '#ffffff' }}
                        >
                            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                <path strokeLinecap="round" d="M6 6l8 8M14 6l-8 8" />
                            </svg>
                        </button>
                    </div>

                    {/* Messages */}
                    <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2" style={{ minHeight: '240px', maxHeight: 'min(60vh, 480px)' }}>
                        {messages.length === 0 ? (
                            <div
                                className="text-sm text-center py-8 px-4"
                                style={{ color: 'var(--text-secondary)' }}
                            >
                                {t('chat.empty_state')}
                            </div>
                        ) : (
                            messages.map(m => (
                                <div
                                    key={m.id}
                                    className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm ${m.direction === 'user' ? 'ml-auto rounded-br-sm' : 'mr-auto rounded-bl-sm'}`}
                                    style={{
                                        background: m.direction === 'user' ? 'var(--accent)' : 'var(--surface-muted)',
                                        color: m.direction === 'user' ? '#ffffff' : 'var(--text-primary)',
                                    }}
                                >
                                    <span className="whitespace-pre-wrap break-words">{m.body}</span>
                                </div>
                            ))
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* Composer */}
                    <div className="px-3 py-3 border-t" style={{ borderColor: 'var(--border-default)' }}>
                        {error && (
                            <p className="text-xs mb-2" style={{ color: '#dc2626' }}>{error}</p>
                        )}
                        {/* Honeypot — visually hidden but reachable to bots */}
                        <input
                            type="text"
                            name="company"
                            autoComplete="off"
                            tabIndex={-1}
                            value={honeypot}
                            onChange={(e) => setHoneypot(e.target.value)}
                            aria-hidden="true"
                            style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px' }}
                        />
                        <div className="flex items-end gap-2">
                            <textarea
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={onKeyDown}
                                placeholder={t('chat.placeholder')}
                                rows={2}
                                maxLength={2000}
                                className="flex-1 px-3 py-2 rounded-lg text-sm resize-none focus:outline-none focus-visible:ring-2"
                                style={{
                                    background: 'var(--surface-base)',
                                    color: 'var(--text-primary)',
                                    border: '1px solid var(--border-default)',
                                }}
                            />
                            <button
                                type="button"
                                onClick={send}
                                disabled={sending || !input.trim()}
                                aria-label={t('chat.send')}
                                title={t('chat.send')}
                                className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-lg transition-all duration-150 hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2"
                                style={{
                                    background: 'var(--accent)',
                                    color: '#ffffff',
                                }}
                            >
                                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 10l14-7-3 14-4-6-7-1z" />
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
