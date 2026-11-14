/**
 * Shared from the phone (Jon 2026-11-14): ask «¿Qué hay en este post?»
 * (an animal for adoption, or a person) before the person import starts.
 * Never for a shared contact card — that is always a person — nor when the
 * person import was chosen on purpose (`kind=person`).
 */
export function shouldAskShareKind(sp: { get(k: string): string | null }): boolean {
    if (sp.get('shared') !== 'true') return false;
    if (sp.get('kind') === 'person') return false;
    if (sp.get('shared_vcard') === 'true' || sp.get('shared_vcard_lost') === 'true' || sp.get('contact_import') === '1') return false;
    return !!(sp.get('shared_url') || sp.get('url') || sp.get('shared_text') || sp.get('text') || sp.get('shared_images') === 'true');
}
