export const runtime = 'edge';

import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db';
import { formSubmissions } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { getUser } from '@/app/actions/_db';
import { getMyAdopters } from '@/app/actions/dashboard';
import Link from 'next/link';
import LinkFormToList from './LinkFormToList';

export default async function FormResultsLinkPage({
    params,
}: {
    params: Promise<{ submissionId: string }>;
}) {
    const { submissionId } = await params;
    let currentUser = '';
    try {
        currentUser = await getUser();
    } catch (e: any) {
        if (e?.digest?.startsWith('NEXT_REDIRECT')) throw e;
        redirect(`/?authRequired=1&callbackUrl=${encodeURIComponent(`/form-results/${submissionId}/link`)}`);
    }

    const db = await getDb();
    if (!db) return <ErrorState message="Database unavailable" />;

    // Auth: verify the current user owns this submission
    const ownerCheck = await db.select({ userId: formSubmissions.userId })
        .from(formSubmissions)
        .where(eq(formSubmissions.id, submissionId))
        .get();
    if (!ownerCheck) return <ErrorState message="Formulario no encontrado" />;
    if (ownerCheck.userId !== currentUser) return <ErrorState message="No tenés permiso para ver este formulario" />;

    const adoptersList = await getMyAdopters('name');
    const adopters = adoptersList.map((a: { id: string; name: string }) => ({ id: a.id, name: a.name }));

    return (
        <main className="container mx-auto px-4 py-8 max-w-2xl">
            <Link href={`/form-results/${submissionId}`} className="text-sm text-stone-500 hover:text-stone-700">
                ← Volver a las respuestas del formulario
            </Link>
            <h1 className="text-xl font-semibold text-stone-800 mt-4 mb-2">
                Vincular este formulario a un perfil
            </h1>
            <p className="text-sm text-stone-500 mb-6">
                Elegí el perfil de adoptante al que querés asociar esta respuesta.
            </p>
            <LinkFormToList submissionId={submissionId} adopters={adopters} />
        </main>
    );
}

function ErrorState({ message }: { message: string }) {
    return (
        <main className="container mx-auto px-4 py-16 text-center">
            <p className="text-stone-600">{message}</p>
            <Link href="/" className="text-teal-600 hover:underline mt-4 inline-block">
                ← Volver al inicio
            </Link>
        </main>
    );
}
