'use client';

import { useRef, useState } from 'react';
import { parseVcard, type ParsedVcardContact } from '@/lib/vcard';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';

/**
 * Stash key for the contact-import handoff between this launcher and the
 * ImportWizard. The wizard's mount-time effect reads + deletes this key
 * when it sees `?contact_import=1`. Shared constant prevents the two ends
 * from drifting.
 */
export const CONTACT_IMPORT_STASH_KEY = 'buenadoptante.contactImport';

/**
 * Minimal types for the Contact Picker API (`navigator.contacts.select`).
 * Not yet in the lib.dom typings (Chromium-only, no W3C REC). We narrow to
 * the four properties we actually request, with the OS-returned shape.
 */
interface PickerContactsManager {
    select: (
        properties: ReadonlyArray<'name' | 'tel' | 'email' | 'address' | 'icon'>,
        options?: { multiple?: boolean }
    ) => Promise<Array<{
        name?: string[];
        tel?: string[];
        email?: string[];
        address?: Array<{
            addressLine?: string[];
            city?: string;
            region?: string;
            postalCode?: string;
            country?: string;
        }>;
    }>>;
}

/** Browsers with the Contact Picker API expose these on navigator + window. */
function hasContactPickerApi(): boolean {
    if (typeof navigator === 'undefined') return false;
    return 'contacts' in navigator
        && typeof window !== 'undefined'
        && 'ContactsManager' in window;
}

/**
 * Normalize a Contact Picker API result into the same shape parseVcard
 * produces, so the wizard's downstream consumer is one branch instead of two.
 */
function pickerResultToParsed(
    result: Awaited<ReturnType<PickerContactsManager['select']>>,
): ParsedVcardContact | null {
    if (!result || result.length === 0) return null;
    const first = result[0];
    const name = (first.name ?? []).filter(Boolean).join(' ').trim();
    const phones = (first.tel ?? []).filter(p => typeof p === 'string' && p.trim());
    const emails = (first.email ?? []).filter(e => typeof e === 'string' && e.trim());
    const addresses = (first.address ?? []).map(a => {
        const street = (a.addressLine ?? []).filter(Boolean).join(' ').trim();
        const locality = [a.city, a.region, a.postalCode, a.country]
            .filter(Boolean).join(', ').trim();
        if (!street && !locality) return null;
        return {
            ...(street ? { streetAndNumber: street } : {}),
            ...(locality ? { locality } : {}),
        };
    }).filter((a): a is { streetAndNumber?: string; locality?: string } => a !== null);
    if (!name && phones.length === 0 && emails.length === 0 && addresses.length === 0) {
        return null;
    }
    return {
        name,
        phones,
        emails,
        addresses,
        pickedFromMultiple: false,
    };
}

interface Props {
    /**
     * Called with the parsed contact after the user picks one and the launcher
     * has stashed it in sessionStorage. Caller is responsible for navigating
     * the user into the ImportWizard (typically via `handleAuthNavigation`
     * to '/import?contact_import=1' — same pattern as the social-media CTA).
     */
    onPicked: (contact: ParsedVcardContact) => void;
    children: React.ReactNode;
    className?: string;
    testId?: string;
}

/**
 * Single-button launcher that opens the OS Contact Picker (Chrome on Android)
 * with a transparent `.vcf` file-input fallback for every other browser. On a
 * successful pick the parsed contact is stashed in sessionStorage and
 * `onPicked` fires; the parent handles navigation into the ImportWizard.
 *
 * Why not feature-detect at render time? UA detection of the Contact Picker
 * API is unreliable (vendor-prefixed shims, feature flags, in-app browsers).
 * A button that disappears at runtime is worse UX than one that opens a
 * slightly different sheet. So we always render; the click chooses the path.
 */
export default function ContactPickerLauncher({ onPicked, children, className, testId }: Props) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const [pending, setPending] = useState(false);

    const stash = (parsed: ParsedVcardContact) => {
        try {
            sessionStorage.setItem(CONTACT_IMPORT_STASH_KEY, JSON.stringify(parsed));
        } catch {
            // sessionStorage write failure is silent — onPicked still fires
            // and the wizard will land empty; not worth blocking the flow.
        }
        if (parsed.pickedFromMultiple) {
            toast.info(t('import.vcard_multiple_picked_first'));
        }
        onPicked(parsed);
    };

    const openFilePicker = () => {
        fileInputRef.current?.click();
    };

    const handleClick = async () => {
        if (pending) return;
        if (!hasContactPickerApi()) {
            openFilePicker();
            return;
        }
        setPending(true);
        try {
            const picker = (navigator as unknown as { contacts: PickerContactsManager }).contacts;
            const result = await picker.select(['name', 'tel', 'email', 'address'], { multiple: false });
            const parsed = pickerResultToParsed(result);
            if (parsed) {
                stash(parsed);
            }
            // User cancelled or returned an empty selection — silent no-op.
        } catch {
            // The Picker API can throw on permission denial or unsupported
            // contexts. Fall back to the file input so the user always has
            // a way forward.
            openFilePicker();
        } finally {
            setPending(false);
        }
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        // Clear immediately so picking the same file twice still fires change.
        e.target.value = '';
        if (!file) return;
        try {
            const text = await file.text();
            const parsed = parseVcard(text);
            if (!parsed) {
                toast.error(t('import.vcard_parse_failed'));
                return;
            }
            stash(parsed);
        } catch {
            toast.error(t('import.vcard_parse_failed'));
        }
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
            <input
                ref={fileInputRef}
                type="file"
                accept=".vcf,text/vcard,text/x-vcard,text/directory"
                onChange={handleFileChange}
                className="hidden"
                aria-hidden="true"
                tabIndex={-1}
            />
        </>
    );
}
