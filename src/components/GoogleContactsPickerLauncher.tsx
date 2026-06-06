'use client';

import { useState, useEffect, useRef } from 'react';
import { useShowToast } from '@/components/ui/Toast';
import { useLanguage } from '@/context/LanguageContext';
import GoogleContactsPickerModal from '@/components/GoogleContactsPickerModal';
import type { GoogleContact } from '@/lib/googleContacts';
import { googleContactToParsed } from '@/lib/googleContacts';
import { CONTACT_IMPORT_STASH_KEY } from '@/components/ContactPickerLauncher';

/**
 * Minimal type surface for Google Identity Services (`window.google.accounts.oauth2`).
 * GIS is the modern Google-recommended path for client-side OAuth tokens —
 * no redirects, a popup window flow, short-lived access token returned
 * straight to JS. We declare only the surface we actually use.
 */
interface GoogleTokenClient {
    requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
}
interface GoogleOAuth2 {
    initTokenClient: (config: {
        client_id: string;
        scope: string;
        callback: (response: { access_token?: string; error?: string }) => void;
        error_callback?: (err: { type?: string; message?: string }) => void;
    }) => GoogleTokenClient;
}
interface GoogleAccounts {
    oauth2: GoogleOAuth2;
}
declare global {
    interface Window { google?: { accounts: GoogleAccounts } }
}

const GIS_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
const SCOPE = 'https://www.googleapis.com/auth/contacts.readonly';

/**
 * Load the Google Identity Services script on demand. Idempotent — if the
 * script tag is already in the DOM (either still loading or fully loaded)
 * we wait for `window.google.accounts` to become available rather than
 * appending a second tag. Resolves once GIS is ready or rejects on load
 * timeout (rare — typically a CSP misconfiguration or network failure).
 */
function loadGis(): Promise<void> {
    return new Promise((resolve, reject) => {
        if (typeof window === 'undefined') {
            reject(new Error('SSR — GIS only loads in the browser'));
            return;
        }
        if (window.google?.accounts?.oauth2) {
            resolve();
            return;
        }
        const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SCRIPT_SRC}"]`);
        const start = Date.now();
        const TIMEOUT_MS = 10_000;
        const poll = () => {
            if (window.google?.accounts?.oauth2) {
                resolve();
                return;
            }
            if (Date.now() - start > TIMEOUT_MS) {
                reject(new Error('GIS load timeout'));
                return;
            }
            setTimeout(poll, 100);
        };
        if (existing) {
            poll();
            return;
        }
        const script = document.createElement('script');
        script.src = GIS_SCRIPT_SRC;
        script.async = true;
        script.defer = true;
        script.onerror = () => reject(new Error('GIS script load failed'));
        document.head.appendChild(script);
        poll();
    });
}

interface Props {
    /**
     * Called after the user has picked a contact and we've stashed the
     * parsed shape in sessionStorage. Caller handles navigation into the
     * wizard (typically `handleAuthNavigation('/import?contact_import=1')`).
     */
    onPicked: () => void;
    children: React.ReactNode;
    className?: string;
    testId?: string;
}

/**
 * Single button that opens the Google Contacts picker via Google Identity
 * Services. The flow on click:
 *
 *   1. Lazily fetch the OAuth client ID from /api/google-contacts/oauth-config.
 *   2. Lazily load the GIS script.
 *   3. Request an access token for the `contacts.readonly` scope. Google's
 *      consent popup renders inside the user's browser; on accept, the
 *      callback fires with `response.access_token` (~1h lifetime).
 *   4. Fetch the user's contacts via /api/google-contacts/list (server-side
 *      trims the payload).
 *   5. Open the picker modal. On pick, stash via the same sessionStorage key
 *      the existing device-contacts flow uses (`CONTACT_IMPORT_STASH_KEY`)
 *      so the wizard's `loadStashedContact` reads it unchanged — no new
 *      wizard branches needed.
 *
 * The token is never persisted — kept in component state for the picker
 * session only, discarded on close. No refresh token, no DB row.
 */
export default function GoogleContactsPickerLauncher({ onPicked, children, className, testId }: Props) {
    const toast = useShowToast();
    const { t } = useLanguage();
    const [pending, setPending] = useState(false);
    const [contacts, setContacts] = useState<GoogleContact[] | null>(null);
    const tokenRef = useRef<string | null>(null);
    const clientIdRef = useRef<string | null>(null);

    // Forget the token if the launcher unmounts mid-flow so we don't leak
    // it across page transitions.
    useEffect(() => {
        return () => {
            tokenRef.current = null;
        };
    }, []);

    const fetchClientId = async (): Promise<string> => {
        if (clientIdRef.current) return clientIdRef.current;
        const res = await fetch('/api/google-contacts/oauth-config');
        if (!res.ok) throw new Error('Failed to load OAuth config');
        const data = await res.json() as { clientId?: string };
        if (!data.clientId) throw new Error('OAuth client ID missing');
        clientIdRef.current = data.clientId;
        return data.clientId;
    };

    const fetchContacts = async (token: string): Promise<GoogleContact[]> => {
        const res = await fetch('/api/google-contacts/list', {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
            // 401 means the token is no longer valid for this scope — fall
            // back to re-prompting next click. For other failures we toast
            // a generic message and let the user retry.
            const code = res.status === 401 ? 'token_expired' : 'fetch_failed';
            throw new Error(code);
        }
        const data = await res.json() as { contacts?: GoogleContact[] };
        return data.contacts ?? [];
    };

    const handleClick = async () => {
        if (pending) return;
        setPending(true);
        try {
            const clientId = await fetchClientId();
            await loadGis();
            if (!window.google?.accounts?.oauth2) {
                throw new Error('GIS unavailable');
            }
            // Wrap the GIS callback as a promise so we can await it cleanly.
            const accessToken = await new Promise<string>((resolve, reject) => {
                const tokenClient = window.google!.accounts.oauth2.initTokenClient({
                    client_id: clientId,
                    scope: SCOPE,
                    callback: (response) => {
                        if (response.access_token) resolve(response.access_token);
                        else reject(new Error(response.error || 'no_token'));
                    },
                    error_callback: (err) => reject(new Error(err.type || err.message || 'oauth_error')),
                });
                tokenClient.requestAccessToken();
            });
            tokenRef.current = accessToken;
            const list = await fetchContacts(accessToken);
            if (list.length === 0) {
                toast.info(t('import.google_contacts_empty'));
                return;
            }
            setContacts(list);
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            // User-cancelled OAuth popup or closed the consent — silent
            // recovery, no toast for those benign cases. Toast everything
            // else as a generic "couldn't connect" with a console-level log
            // for diagnosis.
            const silentErrors = ['popup_closed', 'popup_failed_to_open', 'access_denied'];
            if (!silentErrors.some(s => message.includes(s))) {
                console.warn('[GoogleContactsPickerLauncher] OAuth or fetch failed:', e);
                toast.error(t('import.google_contacts_error'));
            }
        } finally {
            setPending(false);
        }
    };

    const handlePick = (contact: GoogleContact) => {
        try {
            sessionStorage.setItem(
                CONTACT_IMPORT_STASH_KEY,
                JSON.stringify(googleContactToParsed(contact)),
            );
        } catch {
            // sessionStorage write failures are silent — the wizard will
            // render Step 3 blank in that case, which the user can recover
            // from by re-picking; not worth blocking the flow.
        }
        // Drop the token immediately — we're done with it.
        tokenRef.current = null;
        setContacts(null);
        onPicked();
    };

    return (
        <>
            <button
                type="button"
                onClick={handleClick}
                disabled={pending}
                data-testid={testId}
                className={className}
            >
                {children}
            </button>
            {contacts && (
                <GoogleContactsPickerModal
                    contacts={contacts}
                    onPick={handlePick}
                    onClose={() => { setContacts(null); tokenRef.current = null; }}
                />
            )}
        </>
    );
}
