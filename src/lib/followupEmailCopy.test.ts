/**
 * Tests for the follow-up cron's pure copy builders.
 *
 * They live under src/ because vitest.config.ts scopes `include` to
 * `src/**\/*.test.ts` — the worker's own directory is never collected. The
 * module under test is pure (no Worker APIs), so importing it here is safe and
 * gives the least-covered part of the feature (Worker code never runs in CI)
 * real assertions.
 */
import { describe, it, expect } from 'vitest';
import {
    buildFollowupEmail, dedupKey, notificationTitle, slotLabel, EMAIL_DIGEST_MAX_ITEMS,
} from '../../workers/followup-cron/src/copy';

const item = (name: string, n = 1) => ({
    animalName: name,
    body: `Control del primer mes con Adoptante ${n}.`,
    url: `https://app.test/my-animals/a${n}#next-action`,
});

describe('dedupKey', () => {
    it('is stable per (placement, slot, recipient) and case-insensitive on the email', () => {
        expect(dedupKey('p1', 'checkin_7d', 'Someone@Example.com'))
            .toBe('followup:p1:checkin_7d:someone@example.com');
        // Different recipients dedup independently (team fan-out).
        expect(dedupKey('p1', 'checkin_7d', 'a@x.com')).not.toBe(dedupKey('p1', 'checkin_7d', 'b@x.com'));
    });
});

describe('slotLabel', () => {
    it('interpolates the recurring transit/custom slots', () => {
        expect(slotLabel({ copyKey: 'foster_checkin', offsetDays: 60 })).toBe('Control de tránsito (día 60)');
        expect(slotLabel({ copyKey: 'checkin_custom', offsetDays: 45 })).toBe('Control del día 45');
        expect(slotLabel({ copyKey: 'checkin_7d' })).toBe('Control de la primera semana');
    });
});

describe('buildFollowupEmail — one adaptive template', () => {
    it('a single reminder reads exactly like the per-animal notification', () => {
        const mail = buildFollowupEmail([item('Luna')], 'https://app.test/my-animals');
        expect(mail.subject).toBe(notificationTitle('Luna'));
        expect(mail.html).toContain('Control del primer mes');
        // CTA goes to THAT animal, not the list.
        expect(mail.html).toContain('https://app.test/my-animals/a1#next-action');
        expect(mail.html).toContain('Ver en BuenAdoptante');
        expect(mail.text).toContain('Seguimiento pendiente: Luna');
    });

    it('several reminders digest into one message listing each, CTA to the list', () => {
        const mail = buildFollowupEmail([item('Luna', 1), item('Rocco', 2), item('Milo', 3)], 'https://app.test/my-animals');
        expect(mail.subject).toBe('3 seguimientos pendientes');
        for (const name of ['Luna', 'Rocco', 'Milo']) expect(mail.html).toContain(name);
        // Each row keeps its own deep link…
        expect(mail.html).toContain('https://app.test/my-animals/a2#next-action');
        // …and the button points at the triage board.
        expect(mail.html).toContain('Ver mis animales');
        expect(mail.text).toContain('- Rocco —');
    });

    it('caps a huge digest and says how many were omitted', () => {
        const many = Array.from({ length: EMAIL_DIGEST_MAX_ITEMS + 4 }, (_, i) => item(`A${i}`, i));
        const mail = buildFollowupEmail(many, 'https://app.test/my-animals');
        expect(mail.subject).toBe(`${many.length} seguimientos pendientes`);
        expect(mail.html).toContain('…y 4 más.');
        expect(mail.html).not.toContain(`A${EMAIL_DIGEST_MAX_ITEMS + 1}<`);
    });

    it('escapes names and bodies (no HTML injection from user data)', () => {
        const mail = buildFollowupEmail([{ animalName: '<img src=x>', body: 'a & b', url: 'https://app.test/x' }]);
        expect(mail.html).not.toContain('<img src=x>');
        expect(mail.html).toContain('&lt;img src=x&gt;');
        expect(mail.html).toContain('a &amp; b');
    });
});
