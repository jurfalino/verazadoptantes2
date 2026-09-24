'use client';

/**
 * Floating support chat widget.
 *
 * Mounted once at the root layout, gated by the ENABLE_CHAT_WIDGET flag.
 * Holds a per-browser conversationId in localStorage; sends visitor
 * messages to /api/chat (which forwards to admin's Telegram); polls
 * /api/chat for admin replies whenever the tab is visible — every 4s with
 * the panel open, every 25s with it closed — plus an immediate catch-up
 * fetch when a backgrounded tab comes back to the foreground.
 *
 * The closed-panel poll is load-bearing, not a nicety. Until v2.56.78 nothing
 * fetched while the panel was closed, and the one-shot mount fetch was the
 * only other read. An admin reply written after the page loaded therefore
 * never arrived and lit no indicator, however long the visitor kept browsing:
 * client-side navigation does not remount this widget. Measured on production
 * before the fix: one /api/chat request for a whole session.
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
import { mergeMessages, nextSince, unreadAdminCount, type ChatThreadMessage } from '@/domain/chatThread';
import { userFacingMessage } from '@/lib/errorMessage';

const SESSION_KEY = 'chat_session_id';
/**
 * v2 of the last-seen key. v1 (`chat_last_seen_at`) was written from the
 * optimistic bubble's CLIENT clock while every server timestamp is server
 * clock, so a visitor whose clock ran fast stored a value no reply will ever
 * exceed — and the unread indicator stayed dark for good. Those values are not
 * repairable, so they are abandoned rather than migrated. The one-time cost is
 * an indicator on a thread the visitor had already read; `unreadAdminCount`
 * clamps a future value anyway, so this is belt and braces.
 */
const LAST_SEEN_KEY = 'chat_last_seen_v2';
const LEGACY_LAST_SEEN_KEY = 'chat_last_seen_at';
const POLL_OPEN_MS = 4_000;
const POLL_CLOSED_MS = 25_000;

type ChatMessage = ChatThreadMessage;

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
        localStorage.removeItem(LEGACY_LAST_SEEN_KEY);
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
    const [unreadCount, setUnreadCount] = useState(0);
    const [honeypot, setHoneypot] = useState('');
    const lastSeenRef = useRef<number>(0);
    const messagesEndRef = useRef<HTMLDivElement | null>(null);

    /**
     * The poll reads `open` and `messages` through refs on purpose.
     *
     * `fetchMessages` used to close over `open`, and it is a dependency of the
     * mount fetch — so every open/close toggle re-ran a full `since=0` refetch,
     * which is what surfaced the duplicated bubble. `messages` was a dependency
     * of the poll effect, so the 4s timer was torn down and rebuilt on every
     * arriving message. Refs keep both callbacks stable: fetches happen on a
     * schedule, not on a re-render.
     */
    const openRef = useRef(open);
    const messagesRef = useRef<ChatMessage[]>(messages);
    const pollFailureLoggedRef = useRef(false);
    useEffect(() => { openRef.current = open; }, [open]);
    useEffect(() => { messagesRef.current = messages; }, [messages]);

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
                localStorage.removeItem(LEGACY_LAST_SEEN_KEY);
                const raw = localStorage.getItem(LAST_SEEN_KEY);
                if (raw) lastSeenRef.current = Number(raw) || 0;
            } catch { /* localStorage unavailable */ }
            return;
        }
        // Different account, first visit, or a pre-2.56.44 value: start clean.
        lastSeenRef.current = 0;
        setMessages([]);
        messagesRef.current = [];
        setUnreadCount(0);
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
        messagesRef.current = [];
        setUnreadCount(0);
        setError(null);
        setSessionId(startConversation(owner));
    }, [session?.user?.email]);

    // Monotonic on purpose. Two paths advance the read mark — the poll and the
    // effect below — and a slow `since=0` mount fetch can resolve after a fast
    // poll has already moved it. Without this guard the older, smaller value
    // wins and the visitor gets an indicator for a reply they have already read.
    // `unreadAdminCount` clamps a mark that is too HIGH; this is the other side.
    const persistLastSeen = useCallback((ts: number) => {
        if (!Number.isFinite(ts) || ts <= lastSeenRef.current) return;
        lastSeenRef.current = ts;
        try { localStorage.setItem(LAST_SEEN_KEY, String(ts)); } catch { /* localStorage unavailable */ }
    }, []);

    // Opening the panel marks everything currently in the thread as read, so the
    // indicator clears. `nextSince` rather than the last element: the cursor and
    // the read mark must both be the newest SERVER timestamp held.
    useEffect(() => {
        if (!open || messages.length === 0) return;
        persistLastSeen(nextSince(messages));
        setUnreadCount(0);
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
            if (!res.ok) {
                // A poll runs for as long as the page is open, so logging every
                // tick of an outage would drown the console (and Clarity) in
                // noise. Once per session is enough to tell a stuck thread from
                // a quiet one — and `logger` is server-only, so this is the only
                // channel available here.
                if (!pollFailureLoggedRef.current) {
                    pollFailureLoggedRef.current = true;
                    console.warn('chat: poll failed, will keep retrying', { status: res.status, since });
                }
                return;
            }
            pollFailureLoggedRef.current = false;
            const data = (await res.json()) as { messages?: ChatMessage[] };

            // Merged off the ref, not off `prev`, so the read-state side effects
            // below stay out of the state updater (which React may run twice).
            // Writing the ref back immediately also keeps two overlapping polls
            // from each appending the same rows.
            const merged = mergeMessages(messagesRef.current, data?.messages);
            if (merged === messagesRef.current) return;
            messagesRef.current = merged;
            setMessages(prev => mergeMessages(prev, data?.messages));

            if (openRef.current) {
                // Read as it arrives — the panel is in front of the visitor.
                persistLastSeen(nextSince(merged));
                setUnreadCount(0);
            } else {
                setUnreadCount(unreadAdminCount(merged, lastSeenRef.current));
            }
        } catch {
            // Network blip — the next tick retries.
        }
    }, [sessionId, persistLastSeen, resetConversation]);

    // Initial fetch: the visitor's prior thread on a reload, including any reply
    // that landed while the tab was closed. `fetchMessages` no longer closes over
    // `open`, so this runs once per conversation instead of on every toggle.
    useEffect(() => {
        if (sessionId) {
            fetchMessages(0);
        }
    }, [sessionId, fetchMessages]);

    // Poll whenever the tab is visible — 4s with the panel open, 25s with it
    // closed. The closed cadence is the fix for a reply that arrives after the
    // page has loaded: there is no remount to piggyback on, because client-side
    // navigation keeps this widget mounted, so without a background poll nothing
    // ever fetched again and no indicator could light.
    //
    // Hidden tabs are skipped rather than polled, and a tab returning to the
    // foreground fetches immediately instead of waiting out the interval.
    useEffect(() => {
        if (!sessionId) return;
        let cancelled = false;
        const poll = () => {
            if (cancelled) return;
            if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
            void fetchMessages(nextSince(messagesRef.current));
        };
        const handle = setInterval(poll, open ? POLL_OPEN_MS : POLL_CLOSED_MS);
        const onVisibility = () => { if (document.visibilityState === 'visible') poll(); };
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            cancelled = true;
            clearInterval(handle);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [open, sessionId, fetchMessages]);

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
            // Optimistic insert under the SERVER's id and timestamp.
            //
            // This is bug 1. The old code read the id from an `x-chat-local-id`
            // response header that no route has ever set — the id is in the JSON
            // body — so the bubble always got a fabricated `local-<Date.now()>`
            // id. Dedupe is by id, so the server's row for that same message
            // looked new on the next refetch and was appended beside the
            // optimistic copy: the visitor saw what they sent, twice. The
            // client-clock `createdAt` was the same mistake in the time
            // dimension — it poisoned the poll cursor and the read mark, both of
            // which are compared against second-truncated SERVER time.
            const sent = (await res.json().catch(() => ({}))) as { id?: unknown; createdAt?: unknown };
            const serverId = typeof sent.id === 'string' && sent.id ? sent.id : '';
            const serverCreatedAt = typeof sent.createdAt === 'number' && Number.isFinite(sent.createdAt)
                ? sent.createdAt
                : Math.floor(Date.now() / 1000) * 1000;
            // No id comes back only where no row was written — the honeypot and
            // a blocked conversation, both of which answer a bare `{ ok: true }`.
            // Those still get a bubble, because a message that visibly vanishes
            // is exactly the tell that silent-drop exists to avoid; with no row
            // behind it there is nothing for it to duplicate against.
            const inserted: ChatMessage = {
                id: serverId || `local-${serverCreatedAt}`,
                direction: 'user',
                body,
                createdAt: serverCreatedAt,
            };
            const merged = mergeMessages(messagesRef.current, [inserted]);
            messagesRef.current = merged;
            setMessages(prev => mergeMessages(prev, [inserted]));
            setInput('');
        } catch (e) {
            setError(userFacingMessage(e, t('chat.error_send')));
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
                    className="chat-focusable fixed right-4 z-[80] inline-flex items-center justify-center w-14 h-14 rounded-full transition-all duration-200 hover:scale-105 active:scale-95"
                    style={{
                        // Sits 1rem above whatever is pinned to the bottom of the page:
                        // the visit-intent card publishes its height here (0 otherwise).
                        bottom: 'calc(var(--visit-intent-pinned-h, 0px) + 1rem)',
                        background: 'var(--brand-dark)',
                        color: 'var(--btn-primary-text)',
                        boxShadow: '0 8px 32px var(--shadow-lg), 0 2px 8px var(--shadow-color)',
                    }}
                >
                    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                    </svg>
                    {/* The count, not a bare dot: docs/ux-ui-guidelines.md — colour
                        is never the only signal, so a red badge alone fails a
                        colourblind visitor. A digit reads without colour. */}
                    {unreadCount > 0 && (
                        <span
                            className="absolute -top-1 -right-1 min-w-5 h-5 px-1 inline-flex items-center justify-center rounded-full border-2 text-[11px] font-bold leading-none"
                            style={{
                                background: 'var(--status-error-text)',
                                color: 'var(--btn-primary-text)',
                                borderColor: 'var(--brand-dark)',
                            }}
                            aria-label={t('chat.unread_indicator')}
                        >
                            {unreadCount > 9 ? '9+' : unreadCount}
                        </span>
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
