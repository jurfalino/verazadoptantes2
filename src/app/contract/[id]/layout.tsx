import type { Metadata } from 'next';

export const runtime = 'edge';

// Generate OG meta tags for rich link previews
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
    const { id } = await params;

    let title = 'Contrato de Adopción';
    let description = 'Contrato de adopción responsable de animal de compañía';

    try {
        const { getDb } = await import('@/lib/db');
        const db = await getDb();
        if (db) {
            const { adoptions } = await import('@/db/schema');
            const { eq } = await import('drizzle-orm');
            const animal = await db.select().from(adoptions).where(eq(adoptions.id, id)).get();
            if (animal?.animalName) {
                title = `Adoptar a ${animal.animalName} — Contrato de Adopción`;
                description = `Contrato de adopción responsable para ${animal.animalName}${animal.species ? ` (${animal.species})` : ''}. Completa tus datos para formalizar la adopción.`;
            }
        }
    } catch { /* best effort */ }

    return {
        title,
        description,
        openGraph: {
            title,
            description,
            type: 'website',
        },
        twitter: {
            card: 'summary',
            title,
            description,
        },
    };
}

export default function ContractLayout({ children }: { children: React.ReactNode }) {
    return children;
}
