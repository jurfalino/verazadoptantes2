/**
 * Notifications cleanup, Phase 1 (change 1): four types nothing writes are gone —
 * `system` and `household_link_removed` / `household_link_disputed` never had a
 * writer, and `profile_age_changed`'s writer was unreachable once age editing was
 * removed. They are no longer listed, labelled, drawn, templated or categorised.
 *
 * An old row of one of them still reads as a sentence, never a raw key: its stored
 * (Spanish) title/body show, with the generic bell and no type label — the same
 * fallback as the other retired types (`form_result`, `duplicate_candidate`, `import_result`).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NOTIFICATION_TYPES } from './constants';
import { NOTIFICATION_TEMPLATE_KEYS, localizedNotification } from './notificationTemplates';
import { categoryForType } from './emailCategories';
import { NOTIFICATION_TYPE_ICON } from '@/components/NotificationTypeIcon';
import { es } from '@/i18n/locales/es';
import { en } from '@/i18n/locales/en';
import { pt } from '@/i18n/locales/pt';

const RETIRED = ['system', 'household_link_removed', 'household_link_disputed', 'profile_age_changed'] as const;
const labelsOf = (dict: unknown) => (dict as { notifications: { types: Record<string, string> } }).notifications.types;

describe('retired notification types', () => {
    it('are not in NOTIFICATION_TYPES', () => {
        expect(RETIRED.filter(t => (NOTIFICATION_TYPES as readonly string[]).includes(t))).toEqual([]);
    });

    it('have no template', () => {
        expect(RETIRED.filter(t => (NOTIFICATION_TEMPLATE_KEYS as readonly string[]).includes(t))).toEqual([]);
    });

    it('have no icon of their own', () => {
        expect(RETIRED.filter(t => Object.hasOwn(NOTIFICATION_TYPE_ICON, t))).toEqual([]);
    });

    it.each([['es', es], ['en', en], ['pt', pt]])('%s: have no label', (_l, dict) => {
        expect(RETIRED.filter(t => Object.hasOwn(labelsOf(dict), t))).toEqual([]);
    });

    it('fall into the default email category (no entry of their own)', () => {
        for (const t of RETIRED) expect(categoryForType(t), t).toBe('other');
    });

    it('the age writer is gone: no setProfileAge, no notifyProfileAgeChanged', () => {
        const src = readFileSync(join(process.cwd(), 'src/lib/profileIdentity.ts'), 'utf8');
        expect(src).not.toMatch(/\bsetProfileAge\b|\bnotifyProfileAgeChanged\b/);
    });
});

describe('an old row of a retired type still reads', () => {
    const oldAgeRow = {
        title: 'Edad cambiada: Lucas Paez',
        body: 'Ana indicó que Lucas Paez tiene 12 años.',
        metadata: JSON.stringify({ adopterId: 'lucas', template: { key: 'profile_age_changed', params: { actorName: 'Ana', personName: 'Lucas Paez', age: '12' } } }),
    };
    const oldHouseholdRow = {
        title: 'No conviven: Jonathan Urfalino',
        body: 'María indicó que Jonathan Urfalino no vive con Pedro Paez.',
        metadata: { template: { key: 'household_link_removed', params: { actorName: 'María', hostName: 'Pedro Paez', linkedName: 'Jonathan Urfalino' } } },
    };

    it.each(['es', 'en', 'pt'] as const)('%s: its stored text, never a raw key or an empty hole', (locale) => {
        expect(localizedNotification(oldAgeRow, locale)).toEqual({ title: oldAgeRow.title, body: oldAgeRow.body });
        expect(localizedNotification(oldHouseholdRow, locale)).toEqual({ title: oldHouseholdRow.title, body: oldHouseholdRow.body });
        expect(localizedNotification({ title: 'Mantenimiento', body: 'Hoy a las 22 h.', metadata: null }, locale))
            .toEqual({ title: 'Mantenimiento', body: 'Hoy a las 22 h.' });
    });
});
