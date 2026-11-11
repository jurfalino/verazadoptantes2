/**
 * The unsubscribe confirmation names the «Avisos» row exactly as Configuración
 * does (the es locale strings), not a wording of its own.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(() => 'err12345'), debug: vi.fn() } }));

import UnsubscribePage from './page';
import { signUnsubscribe } from '@/lib/emailUnsubscribe';
import { SWITCHABLE_ROW_KEYS, type SwitchableRowKey } from '@/domain/noticeRows';
import { es } from '@/i18n/locales/es';

const SECRET = 'test-secret';
const EMAIL = 'rescuer@example.com';

beforeEach(() => vi.stubEnv('AUTH_SECRET', SECRET));
afterEach(() => vi.unstubAllEnvs());

async function render(c: SwitchableRowKey) {
    const s = await signUnsubscribe(EMAIL, c, SECRET);
    return renderToStaticMarkup(await UnsubscribePage({ searchParams: Promise.resolve({ e: EMAIL, c, s }) }));
}

describe('/email/unsubscribe', () => {
    it.each(SWITCHABLE_ROW_KEYS.map(k => [k]))(
        'the %s confirmation uses the Configuración label', async (c) => {
            expect(await render(c)).toContain(`«${es.settings[`notice_row_${c}`]}»`);
        });
});
