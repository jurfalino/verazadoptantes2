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

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useLanguage } from '@/context/LanguageContext';
import { conversationOwnerKey } from '@/domain/chatAccess';

const SESSION_KEY = 'chat_session_id';
const LAST_SEEN_KEY = 'chat_last_seen_at';
const POLL_INTERVAL_MS = 4_000;

interface ChatMessage {
    id: string;
    direction: 'user' | 'admin';
    body: string;
    createdAt: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The stored conversation is filed under the account that started it.
 *
 * Before v2.56.44 this key held a bare UUID belonging to the BROWSER, so
 * signing out and in as someone else on the same device reopened the first
 * account's support thread. Storing the owner alongside the id means a change
 * of account starts a fresh conversation. Signing in counts as a change, so an
 * anonymous thread never attaches itself to whoever logs in next.
 */
function readStoredConversation(owner: string): string | null {
    if (typeof window === 'undefined') return null;
    try {
        const raw = localStorage.getItem(SESSION_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { owner?: string; id?: string };
        if (parsed?.owner !== owner) return null;
        return parsed.id && UUID_RE.test(parsed.id) ? parsed.id : null;
    } catch {
        // Unparseable, or a bare-UUID value written by an older build. Either
        // way it has no owner we can trust, so it is discarded.
        return null;
    }
}

function startConversation(owner: string): string {
    const fresh = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : '';
    try {
        localStorage.setItem(SESSION_KEY, JSON.stringify({ owner, id: fresh }));
        localStorage.removeItem(LAST_SEEN_KEY);
    } catch { /* localStorage unavailable */ }
    return fresh;
}

export default function ChatWidget() {
    const { t, locale } = useLanguage();
    const { data: session, status } = useSession();

    // Opening message. First name only — the session's display name can be an
    // email handle for some accounts, and "Hola, maria.gonzalez83" is worse than
    // no name at all, so anything that doesn't look like a name falls back to
    // the anonymous copy that signed-out visitors already get.
    const greeting = useMemo(() => {
        const raw = (session?.user?.name || '').trim();
        const first = raw.split(/\s+/)[0] || '';
        const looksLikeAName = first.length > 1 && !/[@._\d]/.test(first);
        return looksLikeAName
            ? t('chat.greeting_named').replace('{name}', first)
            : t('chat.greeting_anon');
    }, [session?.user?.name, t]);
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

    // Resolve the conversation for whoever is signed in now. Waits for the
    // session to settle first: minting an `anon` conversation and swapping it a
    // moment later would leave an orphan thread on every authenticated load.
    useEffect(() => {
        if (status === 'loading') return;
        const owner = conversationOwnerKey(session?.user?.email);
        const stored = readStoredConversation(owner);
        if (stored) {
            setSessionId(stored);
            try {
                const raw = localStorage.getItem(LAST_SEEN_KEY);
                if (raw) lastSeenRef.current = Number(raw) || 0;
            } catch { /* localStorage unavailable */ }
            return;
        }
        // Different account, first visit, or a pre-2.56.44 value: start clean.
        lastSeenRef.current = 0;
        setMessages([]);
        setHasUnread(false);
        setSessionId(startConversation(owner));
    }, [status, session?.user?.email]);

    // Auto-scroll to newest on each render where messages changed
    useEffect(() => {
        if (open && messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
    }, [messages, open]);

    // The server answers 403 with `reset` when the stored id belongs to another
    // account — a shared device, or a session that changed under us. Start a
    // clean conversation rather than showing an error the user cannot act on.
    const resetConversation = useCallback(() => {
        const owner = conversationOwnerKey(session?.user?.email);
        lastSeenRef.current = 0;
        setMessages([]);
        setHasUnread(false);
        setError(null);
        setSessionId(startConversation(owner));
    }, [session?.user?.email]);

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
            if (res.status === 403) {
                resetConversation();
                return;
            }
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
    }, [sessionId, open, persistLastSeen, resetConversation]);

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
            if (res.status === 403) {
                resetConversation();
                return;
            }
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
    }, [input, sending, sessionId, locale, honeypot, t, resetConversation]);

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
                    className="chat-focusable fixed bottom-4 right-4 z-[80] inline-flex items-center justify-center w-14 h-14 rounded-full transition-all duration-200 hover:scale-105 active:scale-95"
                    style={{
                        background: 'var(--brand-dark)',
                        color: 'var(--btn-primary-text)',
                        boxShadow: '0 8px 32px var(--shadow-lg), 0 2px 8px var(--shadow-color)',
                    }}
                >
                    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                    </svg>
                    {hasUnread && (
                        <span
                            className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2"
                            style={{ background: 'var(--status-error-text)', borderColor: 'var(--brand-dark)' }}
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
                    className="fixed bottom-4 right-4 z-[80] w-[calc(100vw-2rem)] sm:w-[380px] max-h-[calc(100vh-2rem)] rounded-2xl flex flex-col overflow-hidden animate-slideDown"
                    style={{
                        background: 'var(--surface-card)',
                        border: '1px solid var(--border-default)',
                        color: 'var(--text-primary)',
                        boxShadow: '0 8px 32px var(--shadow-lg), 0 2px 8px var(--shadow-color)',
                    }}
                >
                    {/* Header */}
                    <div
                        className="px-4 py-3 flex items-center justify-between gap-2"
                        style={{ background: 'var(--brand-dark)', color: 'var(--btn-primary-text)' }}
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
                            className="chat-focusable shrink-0 p-1 rounded-xl transition-opacity opacity-80 hover:opacity-100"
                            style={{ color: 'var(--btn-primary-text)' }}
                        >
                            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                <path strokeLinecap="round" d="M6 6l8 8M14 6l-8 8" />
                            </svg>
                        </button>
                    </div>

                    {/* Messages */}
                    <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2" style={{ minHeight: '240px', maxHeight: 'min(60vh, 480px)' }}>
                        {/* The opening message is a message, not a placeholder: it stays
                            at the top of the thread once the conversation starts. It sat
                            in the old empty state's either/or slot in v2.56.43 and so
                            vanished the moment anyone replied to it. */}
                        <div
                            className="max-w-[85%] mr-auto px-3 py-2 rounded-2xl rounded-bl-sm text-sm"
                            style={{ background: 'var(--surface-muted)', color: 'var(--text-primary)' }}
                        >
                            {greeting}
                        </div>
                        {messages.map(m => (
                            <div
                                key={m.id}
                                className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm ${m.direction === 'user' ? 'ml-auto rounded-br-sm' : 'mr-auto rounded-bl-sm'}`}
                                style={{
                                    background: m.direction === 'user' ? 'var(--brand-dark)' : 'var(--surface-muted)',
                                    color: m.direction === 'user' ? 'var(--btn-primary-text)' : 'var(--text-primary)',
                                }}
                            >
                                <span className="whitespace-pre-wrap break-words">{m.body}</span>
                            </div>
                        ))}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* Composer */}
                    <div className="px-3 py-3 border-t" style={{ borderColor: 'var(--border-default)' }}>
                        {error && (
                            <p className="text-xs mb-2" style={{ color: 'var(--status-error-text)' }}>{error}</p>
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
                                className="chat-focusable flex-1 px-3 py-2 rounded-xl text-sm resize-none"
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
                                className="chat-focusable shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-xl transition-all duration-150 hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-40 disabled:cursor-not-allowed"
                                style={{
                                    background: 'var(--brand-dark)',
                                    color: 'var(--btn-primary-text)',
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
