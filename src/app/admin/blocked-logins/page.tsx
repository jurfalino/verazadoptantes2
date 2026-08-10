export const runtime = 'edge';
import Link from 'next/link';
import { getDb } from '@/app/actions';
import { blockedLogins, errorReports } from '@/db/schema';
import { desc } from 'drizzle-orm';
import { formatDateTime } from '@/lib/dates';
import { StarIcon } from '@/components/StarIcon';
import { getRatingColors } from '@/lib/ratingColors';

interface SummaryItem {
    id: string;
    name: string;
    avgRating: number | null;
    addedBy: string | null;
    lastChangedBy: string[];
    triggers: string[];
}

const REASON_LABELS: Record<string, string> = {
    low_rating: 'Calificación baja',
    too_many_adoptions: 'Muchas adopciones',
    too_many_requests: 'Muchos pedidos',
};

function renderReason(reason: string): string {
    return reason
        .split(',')
        .map(r => REASON_LABELS[r] || r)
        .join(' · ');
}

/**
 * Admin view of blocked sign-in attempts (v2.14.9-14). Lists every row
 * the adopter-login gate has rejected, with link to the matched profile
 * and the addedBy / lastChangedBy actors so the admin can see who's
 * vouched for that adopter historically.
 */
export default async function BlockedLoginsPage() {
    const db = await getDb();
    if (!db) {
        return (
            <div className="max-w-6xl mx-auto p-6">
                <p className="text-stone-500">Base de datos no disponible.</p>
            </div>
        );
    }

    const [rows, reports] = await Promise.all([
        db.select()
            .from(blockedLogins)
            .orderBy(desc(blockedLogins.attemptedAt))
            .limit(200),
        // User-submitted error reports from the /auth-error form. Surfaced
        // here (rather than on a dedicated page) because operators will
        // correlate them with blocked-login attempts by time.
        db.select()
            .from(errorReports)
            .orderBy(desc(errorReports.createdAt))
            .limit(50)
            .catch(() => [] as typeof errorReports.$inferSelect[]),
    ]);

    return (
        <div className="max-w-6xl mx-auto space-y-6">
            <header>
                <h2 className="text-3xl font-semibold text-stone-900">Intentos de login bloqueados</h2>
                <p className="text-stone-500 mt-2 text-sm">
                    Cuentas que intentaron autenticarse pero fueron rechazadas por coincidir con un perfil de adoptante con calificación baja o flags de densidad.
                    Mostrando los últimos {rows.length} intentos.
                </p>
            </header>

            {/* Reportes de usuarios desde /auth-error — opcionalmente con email
                + mensaje. Útil para correlacionar con intentos bloqueados por
                timestamp e IP-hash. */}
            {reports.length > 0 && (
                <section className="space-y-3">
                    <h3 className="text-lg font-semibold text-stone-900">Reportes de error recientes</h3>
                    <div className="bg-white rounded-2xl shadow-sm border border-stone-200 overflow-hidden">
                        <table className="w-full text-sm">
                            <thead className="bg-stone-50 text-xs font-semibold text-stone-600 uppercase tracking-wider">
                                <tr>
                                    <th className="px-4 py-3 text-left">Cuándo</th>
                                    <th className="px-4 py-3 text-left">Email</th>
                                    <th className="px-4 py-3 text-left">Mensaje</th>
                                    <th className="px-4 py-3 text-left">IP hash</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-stone-100">
                                {reports.map((r: typeof errorReports.$inferSelect) => (
                                    <tr key={r.id} className="hover:bg-stone-50 align-top">
                                        <td className="px-4 py-3 text-stone-600 text-xs whitespace-nowrap">
                                            {r.createdAt ? formatDateTime(r.createdAt) : '—'}
                                        </td>
                                        <td className="px-4 py-3 text-stone-900 font-mono text-xs break-all">
                                            {r.email || <span className="text-stone-400">—</span>}
                                        </td>
                                        <td className="px-4 py-3 text-stone-700 text-xs leading-relaxed whitespace-pre-wrap">
                                            {r.message || <span className="text-stone-400 italic">(vacío)</span>}
                                        </td>
                                        <td className="px-4 py-3 text-stone-500 font-mono text-xs">
                                            {r.ipHash || '—'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            )}

            <h3 className="text-lg font-semibold text-stone-900 pt-4">Intentos bloqueados</h3>
            {rows.length === 0 ? (
                <div className="bg-white p-12 rounded-2xl shadow-sm border border-stone-200 text-center text-stone-500">
                    <p className="text-base">Ningún intento bloqueado todavía.</p>
                    <p className="text-xs mt-2 text-stone-400">
                        Cuando alguien con un perfil flagged intente loguearse, va a aparecer acá.
                    </p>
                </div>
            ) : (
                <div className="bg-white rounded-2xl shadow-sm border border-stone-200 overflow-hidden">
                    <table className="w-full text-sm">
                        <thead className="bg-stone-50 text-xs font-semibold text-stone-600 uppercase tracking-wider">
                            <tr>
                                <th className="px-4 py-3 text-left">Cuándo</th>
                                <th className="px-4 py-3 text-left">Email</th>
                                <th className="px-4 py-3 text-left">Motivo</th>
                                <th className="px-4 py-3 text-left">Perfiles coincidentes</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-stone-100">
                            {rows.map((row: typeof blockedLogins.$inferSelect) => {
                                let summary: SummaryItem[] = [];
                                try {
                                    summary = JSON.parse(row.matchedSummary || '[]');
                                } catch { summary = []; }
                                return (
                                    <tr key={row.id} className="hover:bg-stone-50">
                                        <td className="px-4 py-3 text-stone-600 text-xs whitespace-nowrap align-top">
                                            {row.attemptedAt ? formatDateTime(row.attemptedAt) : '—'}
                                        </td>
                                        <td className="px-4 py-3 text-stone-900 font-mono text-xs break-all align-top">
                                            {row.email}
                                        </td>
                                        <td className="px-4 py-3 text-rose-700 font-medium text-xs align-top whitespace-nowrap">
                                            {renderReason(row.reason)}
                                        </td>
                                        <td className="px-4 py-3 align-top">
                                            <ul className="space-y-2">
                                                {summary.length === 0 ? (
                                                    <li className="text-stone-400 text-xs">—</li>
                                                ) : summary.map((m) => (
                                                    <li key={m.id} className="text-xs">
                                                        <Link
                                                            href={`/adopter/${m.id}`}
                                                            className="text-teal-700 hover:text-teal-800 font-medium underline underline-offset-2"
                                                        >
                                                            {m.name || m.id}
                                                        </Link>
                                                        <span className="text-stone-500 ml-2">
                                                            {m.avgRating != null && (
                                                                <span title="Calificación promedio" className="inline-flex items-center gap-1"><StarIcon className={`w-3 h-3 ${getRatingColors(m.avgRating).text}`} />{m.avgRating.toFixed(1)}</span>
                                                            )}
                                                            {m.triggers.length > 0 && (
                                                                <span className="ml-1 text-stone-400">
                                                                    · {m.triggers.map(t => REASON_LABELS[t] || t).join(', ')}
                                                                </span>
                                                            )}
                                                        </span>
                                                        <div className="text-stone-500 mt-0.5">
                                                            {m.addedBy && (
                                                                <span>Creado por <span className="font-mono">{m.addedBy}</span></span>
                                                            )}
                                                            {m.lastChangedBy.length > 0 && (
                                                                <span className="ml-2">· Editado por <span className="font-mono">{m.lastChangedBy.join(', ')}</span></span>
                                                            )}
                                                        </div>
                                                    </li>
                                                ))}
                                            </ul>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
