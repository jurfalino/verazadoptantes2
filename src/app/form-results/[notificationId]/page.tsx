export const runtime = 'edge';

import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db';
import { notifications, adopters, formSubmissions } from '@/db/schema';
import { eq, or } from 'drizzle-orm';
import { getUser } from '@/app/actions/_db';
import { markNotificationRead } from '@/app/actions/notifications';
import FormResultsContent from '@/components/FormResultsContent';
import Link from 'next/link';

interface MatchedAdopter {
    id: string;
    name: string;
    matchTypes: string[];
}

interface NotificationMetadata {
    submissionId: string;
    matchCount: number;
    submittedData?: {
        name: string;
        email: string;
        phone: string;
        address: string;
        species: string;
        lifeStage: string;
        intent: string;
        household: string;
    };
    matchedAdopters?: MatchedAdopter[];
}

const MATCH_TYPE_LABELS: Record<string, { icon: string; label: string }> = {
    'token:name_full': { icon: '👤', label: 'Nombre completo' },
    'token:name_word': { icon: '📝', label: 'Nombre parcial' },
    'token:phone': { icon: '📱', label: 'Teléfono' },
    'token:phone_suffix': { icon: '📞', label: 'Teléfono (sufijo)' },
    'token:email': { icon: '📧', label: 'Email' },
    'token:social': { icon: '🌐', label: 'Red social' },
    'like:name': { icon: '👤', label: 'Nombre' },
    'like:contact': { icon: '📱', label: 'Contacto' },
};

const SPECIES_LABELS: Record<string, string> = {
    dog: '🐶 Perro', cat: '🐱 Gato', both: '🐾 Ambos', other: '🐾 Otro',
};

const LIFE_STAGE_LABELS: Record<string, string> = {
    puppy: 'Cachorro', young: 'Joven', senior: 'Senior', none: 'Sin preferencia',
};

const HOUSEHOLD_LABELS: Record<string, string> = {
    children: '👶 Niños', pets: '🐾 Mascotas', outdoor: '🏡 Exterior seguro', presence: '🏠 Presencia frecuente',
};

export default async function FormResultsPage({ params }: { params: Promise<{ notificationId: string }> }) {
    const { notificationId } = await params;
    let currentUser = '';
    try {
        currentUser = await getUser();
    } catch (e: any) {
        if (e?.digest?.startsWith('NEXT_REDIRECT')) throw e;
        redirect(`/?authRequired=1&callbackUrl=${encodeURIComponent(`/form-results/${notificationId}`)}`);
    }

    const db = await getDb();
    if (!db) return <ErrorState message="Database unavailable" />;

    const notification = await db.select().from(notifications).where(eq(notifications.id, notificationId)).get();
    if (!notification) return <ErrorState message="Notificación no encontrada" />;
    if (notification.userId !== currentUser) return <ErrorState message="No tenés permiso para ver esta notificación" />;

    await markNotificationRead(notificationId, currentUser);

    let metadata: NotificationMetadata = { submissionId: '', matchCount: 0 };
    try {
        const parsed = notification.metadata ? JSON.parse(notification.metadata) : {};
        metadata = {
            submissionId: parsed.submissionId ?? '',
            matchCount: parsed.matchCount ?? 0,
            submittedData: parsed.submittedData,
            matchedAdopters: parsed.matchedAdopters,
        };
    } catch {
        // Invalid metadata JSON — keep defaults
    }

    // Load the full submission
    let submission: {
        id: string; selfieUrl: string | null; species: string | null; lifeStage: string | null;
        specialNeeds: number | null; intent: string | null; household: string | null;
        latitude: string | null; longitude: string | null; status: string | null;
        linkedAdopterId: string | null; answersJson: string | null;
    } | undefined;
    if (metadata.submissionId) {
        submission = await db
            .select({
                id: formSubmissions.id,
                selfieUrl: formSubmissions.selfieUrl,
                species: formSubmissions.species,
                lifeStage: formSubmissions.lifeStage,
                specialNeeds: formSubmissions.specialNeeds,
                intent: formSubmissions.intent,
                household: formSubmissions.household,
                latitude: formSubmissions.latitude,
                longitude: formSubmissions.longitude,
                status: formSubmissions.status,
                linkedAdopterId: formSubmissions.linkedAdopterId,
                answersJson: formSubmissions.answersJson,
            })
            .from(formSubmissions)
            .where(eq(formSubmissions.id, metadata.submissionId))
            .get();
    }

    // Fetch matched adopter profiles
    let matchedProfiles: Array<{ id: string; name: string; contactInfo: string | null; status: string | null }> = [];
    if (metadata.matchedAdopters && metadata.matchedAdopters.length > 0) {
        const adopterIds = metadata.matchedAdopters.map(a => a.id);
        matchedProfiles = await db
            .select({ id: adopters.id, name: adopters.name, contactInfo: adopters.contactInfo, status: adopters.status })
            .from(adopters)
            .where(or(...adopterIds.map(id => eq(adopters.id, id)))!)
            .all();
    }

    const hasMatches = (metadata.matchCount ?? 0) > 0;
    const submitted = metadata.submittedData;
    let fullAnswers: Record<string, any> = (metadata.submittedData as any) || {};
    try {
        if (submission?.answersJson) fullAnswers = JSON.parse(submission.answersJson);
    } catch {
        // Keep submittedData fallback
    }
    let householdItems: string[] = [];
    try {
        if (submission?.household) {
            const parsed = JSON.parse(submission.household);
            householdItems = Array.isArray(parsed) ? parsed : [];
        }
    } catch {
        // Invalid household JSON
    }

    return (
        <FormResultsContent
            notificationId={notificationId}
            submitted={submitted}
            submission={submission}
            fullAnswers={fullAnswers}
            householdItems={householdItems}
            hasMatches={hasMatches}
            matchCount={metadata.matchCount ?? 0}
            matchedAdopters={metadata.matchedAdopters}
            matchedProfiles={matchedProfiles}
        />
    );
}

function ErrorState({ message }: { message: string }) {
    return (
        <main className="container mx-auto px-4 py-16 text-center">
            <p className="text-2xl mb-2">😕</p>
            <p className="text-sm text-stone-500 font-medium">{message}</p>
            <Link href="/" className="text-sm text-blue-600 hover:text-blue-700 mt-4 inline-block">
                ← Volver al inicio
            </Link>
        </main>
    );
}
