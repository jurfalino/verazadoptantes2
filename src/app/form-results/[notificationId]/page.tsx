export const runtime = 'edge';

import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db';
import { notifications, adopters, formSubmissions } from '@/db/schema';
import { eq, or } from 'drizzle-orm';
import { getUser } from '@/app/actions/_db';
import { markNotificationRead } from '@/app/actions/notifications';
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

    const metadata: NotificationMetadata = notification.metadata ? JSON.parse(notification.metadata) : {};

    // Load the full submission
    let submission: {
        id: string; selfieUrl: string | null; species: string | null; lifeStage: string | null;
        specialNeeds: number | null; intent: string | null; household: string | null;
        latitude: string | null; longitude: string | null; status: string | null;
        linkedAdopterId: string | null;
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

    const hasMatches = metadata.matchCount > 0;
    const submitted = metadata.submittedData;
    const householdItems: string[] = submission?.household ? JSON.parse(submission.household) : [];

    return (
        <main className="container mx-auto px-4 py-8 max-w-2xl">
            {/* Header */}
            <div className="mb-6">
                <Link href="/my-animals" className="text-sm text-stone-500 hover:text-stone-600 transition-colors">
                    ← Mis animales
                </Link>
                <h1 className="text-xl font-semibold text-stone-800 mt-2">
                    📋 Respuestas del formulario
                </h1>
                {submitted?.name && (
                    <p className="text-sm text-stone-500 mt-1">
                        Completado por <span className="font-semibold text-stone-700">{submitted.name}</span>
                    </p>
                )}
            </div>

            {/* Status Banner */}
            <div className={`rounded-xl p-4 mb-6 ${hasMatches ? 'bg-amber-50 border border-amber-200' : 'bg-teal-50 border border-teal-200'}`}>
                <p className={`text-sm font-semibold ${hasMatches ? 'text-amber-800' : 'text-teal-800'}`}>
                    {hasMatches
                        ? `⚠️ Se encontraron ${metadata.matchCount} coincidencia${metadata.matchCount > 1 ? 's' : ''} con perfiles existentes`
                        : '✅ No se encontraron registros previos para esta persona'
                    }
                </p>
                <p className={`text-xs mt-1 ${hasMatches ? 'text-amber-600' : 'text-teal-700'}`}>
                    {hasMatches
                        ? 'Revisá los perfiles a continuación. Podés vincular esta solicitud a un perfil existente o crear uno nuevo.'
                        : 'Podés crear un nuevo perfil de adoptante con estos datos.'
                    }
                </p>
            </div>

            {/* Selfie */}
            {submission?.selfieUrl && (
                <div className="mb-6 text-center">
                    <img
                        src={submission.selfieUrl}
                        alt="Selfie del solicitante"
                        className="w-24 h-24 rounded-full object-cover mx-auto border-2 border-stone-200 shadow-sm"
                    />
                </div>
            )}

            {/* Contact Data */}
            {submitted && (
                <div className="bg-white rounded-xl border border-stone-200 p-4 mb-4 shadow-sm">
                    <h2 className="text-sm font-semibold text-stone-700 mb-3">👤 Datos de contacto</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {submitted.name && <DataPill label="Nombre" value={submitted.name} />}
                        {submitted.email && <DataPill label="Email" value={submitted.email} />}
                        {submitted.phone && <DataPill label="Teléfono" value={submitted.phone} />}
                        {submitted.address && <DataPill label="Dirección" value={submitted.address} />}
                    </div>
                </div>
            )}

            {/* Preferences */}
            <div className="bg-white rounded-xl border border-stone-200 p-4 mb-4 shadow-sm">
                <h2 className="text-sm font-semibold text-stone-700 mb-3">🐾 Preferencias de adopción</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {submitted?.species && (
                        <DataPill label="Especie" value={SPECIES_LABELS[submitted.species] || submitted.species} />
                    )}
                    {submitted?.lifeStage && (
                        <DataPill label="Edad" value={LIFE_STAGE_LABELS[submitted.lifeStage] || submitted.lifeStage} />
                    )}
                    {submitted?.intent && (
                        <DataPill label="Intención" value={submitted.intent === 'self' ? 'Para sí mismo' : 'Es un regalo'} />
                    )}
                    {submission?.specialNeeds === 1 && (
                        <DataPill label="Necesidades especiales" value="✅ Abierto" />
                    )}
                </div>
            </div>

            {/* Household */}
            {householdItems.length > 0 && (
                <div className="bg-white rounded-xl border border-stone-200 p-4 mb-4 shadow-sm">
                    <h2 className="text-sm font-semibold text-stone-700 mb-3">🏠 Hogar</h2>
                    <div className="flex flex-wrap gap-2">
                        {householdItems.map(item => (
                            <span key={item} className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-stone-100 text-stone-700">
                                {HOUSEHOLD_LABELS[item] || item}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* Geolocation */}
            {submission?.latitude && submission?.longitude && (
                <div className="bg-white rounded-xl border border-stone-200 p-4 mb-4 shadow-sm">
                    <h2 className="text-sm font-semibold text-stone-700 mb-2">📍 Ubicación verificada</h2>
                    <p className="text-xs text-stone-500">
                        {submission.latitude}, {submission.longitude}
                    </p>
                </div>
            )}

            {/* Matched Profiles */}
            {hasMatches && metadata.matchedAdopters && (
                <div className="space-y-3 mb-6">
                    <h2 className="text-sm font-semibold text-stone-700">🔍 Perfiles coincidentes</h2>
                    {metadata.matchedAdopters.map((match) => {
                        const profile = matchedProfiles.find(p => p.id === match.id);
                        if (!profile) return null;

                        return (
                            <Link
                                key={match.id}
                                href={`/adopter/${match.id}`}
                                className="block bg-white rounded-xl border border-stone-200 p-4 shadow-sm hover:shadow-md hover:border-stone-300 transition-all"
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-semibold text-stone-800">{profile.name}</p>
                                        {profile.contactInfo && (
                                            <p className="text-xs text-stone-500 mt-0.5 line-clamp-2">{profile.contactInfo}</p>
                                        )}
                                        <div className="flex flex-wrap gap-1.5 mt-2">
                                            {match.matchTypes.map((type) => {
                                                const label = MATCH_TYPE_LABELS[type];
                                                return (
                                                    <span
                                                        key={type}
                                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700"
                                                    >
                                                        {label?.icon || '🔗'} {label?.label || type}
                                                    </span>
                                                );
                                            })}
                                        </div>
                                    </div>
                                    <svg className="w-4 h-4 text-stone-500 flex-shrink-0 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                    </svg>
                                </div>
                            </Link>
                        );
                    })}
                </div>
            )}

            {/* Actions */}
            {submission?.status !== 'linked' && (
                <div className="mt-6 pt-4 border-t border-stone-200 space-y-3">
                    <p className="text-xs text-stone-500 font-medium mb-2">Acciones</p>
                    {/* TODO: In Phase 2, these could link to adopter creation/linking forms */}
                    <Link
                        href={`/my-animals/new?fromForm=${metadata.submissionId}`}
                        className="flex items-center gap-2 px-4 py-3 bg-teal-50 rounded-xl border border-teal-200 text-sm font-semibold text-teal-700 hover:bg-teal-100 transition-colors"
                    >
                        ➕ Crear nuevo perfil con estos datos
                    </Link>
                </div>
            )}

            {submission?.status === 'linked' && submission.linkedAdopterId && (
                <div className="mt-6 pt-4 border-t border-stone-200">
                    <Link
                        href={`/adopter/${submission.linkedAdopterId}`}
                        className="inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 font-medium transition-colors"
                    >
                        👤 Ver perfil del adoptante vinculado →
                    </Link>
                </div>
            )}
        </main>
    );
}

function DataPill({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-start gap-2 text-xs">
            <span className="text-stone-500 font-medium whitespace-nowrap">{label}:</span>
            <span className="text-stone-700 break-all">{value}</span>
        </div>
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
