export const runtime = 'edge';

import { EMAIL_CATEGORIES, type EmailCategory } from '@/domain/emailCategories';
import { resolveAuthSecret } from '@/lib/otp';
import { verifyUnsubscribe } from '@/lib/emailUnsubscribe';

const LABELS: Record<EmailCategory, string> = {
    requests: 'Solicitudes',
    forms: 'Formularios',
    merges: 'Fusiones de perfiles',
    contact_access: 'Acceso a contactos',
    profile_changes: 'Cambios en perfiles',
    api: 'API',
    other: 'Otras notificaciones',
};

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
    const category = EMAIL_CATEGORIES.find((x) => x === c);

    if (first(sp.done) === '1' && category) {
        return (
            <Card>
                <p className="text-stone-900 font-medium">Listo. Podés volver a activarlo en Configuración.</p>
            </Card>
        );
    }

    let valid = false;
    if (!first(sp.invalid) && e && s && category) {
        try {
            valid = await verifyUnsubscribe(e, c, s, resolveAuthSecret());
        } catch {
            valid = false;
        }
    }
    if (!valid || !category) {
        return (
            <Card>
                <p className="text-stone-900 font-medium">Este enlace no es válido.</p>
            </Card>
        );
    }

    return (
        <Card>
            <p className="text-stone-900 font-medium">¿Dejar de recibir «{LABELS[category]}» por email?</p>
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
