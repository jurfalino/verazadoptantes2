export const runtime = 'edge';

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { logger } from '@/lib/logger';
import { getFeatureFlag } from '@/config/features';

/**
 * Fetch the signed-in user's Google Contacts via the People API (v2.18.0).
 *
 * The client passes its own access token via the Authorization header.
 * That token was obtained client-side via Google Identity Services
 * (`google.accounts.oauth2.initTokenClient`) with the `contacts.readonly`
 * scope after the user clicked the "Desde Google Contacts" button — the
 * scope is incremental, separate from the sign-in OAuth flow, so existing
 * users don't see a changed consent dialog at sign-in time.
 *
 * Why fetch server-side instead of straight from the client:
 *   - We can trim the response shape before it crosses the wire — only
 *     name / phones / emails / addresses come back, not birthdays /
 *     organizations / photos / biographical data, which limits the PII
 *     surface to exactly what the wizard's `hydrateFromContact` needs.
 *   - We can log at the server side without depending on client telemetry
 *     completing before navigation.
 *   - The token doesn't sit in client-readable JS for long.
 *
 * The token itself is NOT persisted server-side — we use it for this one
 * call and forget it. No refresh, no DB row. Each pick session re-runs
 * the GIS token-client flow.
 *
 * Page size is capped at 200 contacts per response, which covers the
 * realistic case (rescuers usually have <200 contacts they'd consider
 * for adoption profiles). The People API paginates with `pageToken`;
 * we don't surface that yet — first page only. If users hit the cap
 * frequently, add a "load more" or a search field that switches to
 * `people.searchContacts` for the rest.
 */

interface GooglePerson {
    resourceName?: string;
    names?: Array<{ displayName?: string; givenName?: string; familyName?: string }>;
    phoneNumbers?: Array<{ value?: string; type?: string; canonicalForm?: string }>;
    emailAddresses?: Array<{ value?: string; type?: string }>;
    addresses?: Array<{
        formattedValue?: string;
        streetAddress?: string;
        city?: string;
        region?: string;
        postalCode?: string;
        country?: string;
    }>;
}

export interface TrimmedContact {
    /** Stable id for React keys — Google's resourceName ("people/c12345"). */
    id: string;
    name: string;
    phones: string[];
    emails: string[];
    addresses: Array<{
        streetAndNumber?: string;
        locality?: string;
        raw?: string;
    }>;
}

const PERSON_FIELDS = ['names', 'phoneNumbers', 'emailAddresses', 'addresses'].join(',');

function trimPerson(p: GooglePerson): TrimmedContact | null {
    const id = p.resourceName || '';
    if (!id) return null;
    const primaryName = p.names?.[0];
    const name = primaryName?.displayName
        || [primaryName?.givenName, primaryName?.familyName].filter(Boolean).join(' ').trim()
        || '';
    const phones = (p.phoneNumbers ?? [])
        .map(x => (x.canonicalForm || x.value || '').trim())
        .filter(v => v.length > 0);
    const emails = (p.emailAddresses ?? [])
        .map(x => (x.value || '').trim())
        .filter(v => v.length > 0);
    const addresses = (p.addresses ?? []).map(a => {
        const street = (a.streetAddress || '').trim();
        const locality = [a.city, a.region, a.postalCode, a.country]
            .filter(Boolean).join(', ').trim();
        if (street || locality) {
            return {
                ...(street ? { streetAndNumber: street } : {}),
                ...(locality ? { locality } : {}),
            };
        }
        // Fall back to formattedValue when structured fields are absent.
        const raw = (a.formattedValue || '').trim();
        return raw ? { raw } : null;
    }).filter((a): a is TrimmedContact['addresses'][number] => a !== null);

    // Drop contacts with no usable data — they'd land the user on a blank
    // wizard Step 3 and nothing else.
    if (!name && phones.length === 0 && emails.length === 0 && addresses.length === 0) {
        return null;
    }
    return { id, name, phones, emails, addresses };
}

export async function GET(request: Request) {
    const session = await auth();
    if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const enabled = await getFeatureFlag('ENABLE_GOOGLE_CONTACTS_IMPORT');
    if (!enabled) {
        return NextResponse.json({ error: 'Feature not enabled' }, { status: 403 });
    }

    const authHeader = request.headers.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token) {
        return NextResponse.json({ error: 'Missing access token' }, { status: 400 });
    }

    try {
        const url = `https://people.googleapis.com/v1/people/me/connections?personFields=${PERSON_FIELDS}&pageSize=200&sortOrder=FIRST_NAME_ASCENDING`;
        const res = await fetch(url, {
            headers: { Authorization: `Bearer ${token}` },
        });

        if (!res.ok) {
            // 401 from Google = token expired or missing scope — let the
            // client know so it can re-prompt rather than retry blindly.
            const status = res.status === 401 ? 401 : 502;
            const body = await res.text().catch(() => '');
            logger.warn('People API list failed', {
                status: res.status,
                userEmail: session.user.email,
                bodyExcerpt: body.slice(0, 200),
            });
            return NextResponse.json({ error: 'Google People API error', upstreamStatus: res.status }, { status });
        }

        const data = await res.json() as { connections?: GooglePerson[]; totalPeople?: number; totalItems?: number };
        const contacts: TrimmedContact[] = (data.connections ?? [])
            .map(trimPerson)
            .filter((c): c is TrimmedContact => c !== null);

        logger.info('Google Contacts list fetched', {
            userEmail: session.user.email,
            contactCount: contacts.length,
            totalAvailable: data.totalPeople ?? data.totalItems ?? contacts.length,
        });

        return NextResponse.json({ contacts });
    } catch (e) {
        const errorId = logger.error('Google Contacts list failed', e, {
            userEmail: session.user.email,
        });
        return NextResponse.json({ error: 'Failed to fetch contacts', errorId }, { status: 500 });
    }
}
