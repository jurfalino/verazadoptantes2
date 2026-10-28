/**
 * Audit B4: every notification type the app writes has a label in es, en and pt
 * and its own lucide icon — /notificaciones' filter chips and the bell never show
 * a raw key, an emoji or a bare «+».
 */
import { describe, it, expect } from 'vitest';
import { NOTIFICATION_TYPES } from '@/domain/constants';
import { NOTIFICATION_TYPE_ICON } from './NotificationTypeIcon';
import { es } from '@/i18n/locales/es';
import { en } from '@/i18n/locales/en';
import { pt } from '@/i18n/locales/pt';

const typesOf = (dict: unknown) => ((dict as { notifications: { types?: Record<string, string> } }).notifications.types ?? {});

describe('notification types', () => {
    it.each([['es', es], ['en', en], ['pt', pt]])('%s: every type has a label', (_l, dict) => {
        const labels = typesOf(dict);
        const missing = NOTIFICATION_TYPES.filter(type => !labels[type]?.trim());
        expect(missing).toEqual([]);
    });
    it('every type has its own icon', () => {
        expect(NOTIFICATION_TYPES.filter(type => !NOTIFICATION_TYPE_ICON[type])).toEqual([]);
    });
});
