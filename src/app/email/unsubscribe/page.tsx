export const runtime = 'edge';

import { unsubscribeRows, type SwitchableRowKey } from '@/domain/noticeRows';
import { resolveAuthSecret } from '@/lib/otp';
import { logger } from '@/lib/logger';
import { verifyUnsubscribe } from '@/lib/emailUnsubscribe';
import { es } from '@/i18n/locales/es';

/** The same names Configuración → «Avisos» shows (Spanish, like the emails). */
const label = (row: SwitchableRowKey): string => es.settings[`notice_row_${row}`];

/** «A», «A» y «B», «A», «B» y «C»: an old category's link names every row it switches off. */
function labels(rows: readonly SwitchableRowKey[]): string {
    const quoted = rows.map(r => `«${label(r)}»`);
    return quoted.length > 1 ? `${quoted.slice(0, -1).join(', ')} y ${quoted[quoted.length - 1]}` : quoted[0];
}

function first(v: string | string[] | undefined): string {
    return (Array.isArray(v) ? v[0] : v) ?? '';
}

function Card({ children }: { children: React.ReactNode }) {
    return (
        <main className="min-h-screen bg-stone-50 flex items-start justify-center p-4 pt-16">
            <div className="w-full max-w-md bg-white rounded-xl border border-stone-200 p-6 space-y-4">{children}</div>
        </main>
    );
}

export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const sp = await searchParams;
    const e = first(sp.e);
    const c = first(sp.c);
    const s = first(sp.s);
    // A row key, or an old category (emails sent before «Avisos») mapped to its rows.
    const rows = unsubscribeRows(c);

    const errorId = first(sp.error);
    if (errorId) {
        return (
            <Card>
                <p className="text-stone-900 font-medium">No pudimos procesarlo. Intentá de nuevo en un rato. (código {errorId.slice(0, 16)})</p>
            </Card>
        );
    }

    if (first(sp.done) === '1' && rows) {
        return (
            <Card>
                <p className="text-stone-900 font-medium">Listo. Podés volver a activarlo en Configuración.</p>
            </Card>
        );
    }

    let valid = false;
    if (!first(sp.invalid) && e && s && rows) {
        try {
            valid = await verifyUnsubscribe(e, c, s, resolveAuthSecret());
        } catch (err) {
            logger.warn('email.unsubscribe: page verify failed', { category: c, error: err instanceof Error ? err.message : String(err) });
            valid = false;
        }
    }
    if (!valid || !rows) {
        return (
            <Card>
                <p className="text-stone-900 font-medium">Este enlace no es válido.</p>
            </Card>
        );
    }

    return (
        <Card>
            <p className="text-stone-900 font-medium">¿Dejar de recibir {labels(rows)} por email?</p>
            <form method="POST" action="/api/email/unsubscribe">
                <input type="hidden" name="e" value={e} />
                <input type="hidden" name="c" value={c} />
                <input type="hidden" name="s" value={s} />
                <button type="submit" className="bg-teal-600 hover:bg-teal-700 text-white font-medium rounded-lg px-4 py-2">
                    Sí, dejar de recibir
                </button>
            </form>
        </Card>
    );
}
