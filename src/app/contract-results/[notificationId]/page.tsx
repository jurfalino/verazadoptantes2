export const runtime = 'edge';

import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db';
import { notifications, adopters } from '@/db/schema';
import { eq, or, and, isNull } from 'drizzle-orm';
import { getUser } from '@/app/actions/_db';
import { markNotificationRead } from '@/app/actions/notifications';
import Link from 'next/link';

interface MatchedAdopter {
    id: string;
    name: string;
    matchTypes: string[];
}

interface NotificationMetadata {
    notificationId?: string;
    animalId: string;
    animalName: string;
    adopterId: string;
    adopterName: string;
    matchCount: number;
    matchedAdopters?: MatchedAdopter[];
    submittedData?: {
        name: string;
        phone: string;
        email: string;
        dni: string;
        address: string;
        socialNetworks: string;
    };
}

const MATCH_TYPE_LABELS: Record<string, { icon: string; es: string; en: string }> = {
    // Token-based matches
    'token:name_full': { icon: '👤', es: 'Nombre completo', en: 'Full name' },
    'token:name_word': { icon: '📝', es: 'Nombre parcial', en: 'Partial name' },
    'token:phone': { icon: '📱', es: 'Teléfono', en: 'Phone' },
    'token:phone_suffix': { icon: '📞', es: 'Teléfono (sufijo)', en: 'Phone (suffix)' },
    'token:email': { icon: '📧', es: 'Email', en: 'Email' },
    'token:social': { icon: '🌐', es: 'Red social', en: 'Social network' },
    'token:address_word': { icon: '📍', es: 'Dirección', en: 'Address' },
    // LIKE-based matches
    'like:name': { icon: '👤', es: 'Nombre', en: 'Name' },
    'like:contact': { icon: '📱', es: 'Contacto', en: 'Contact' },
    // Unprefixed taxonomy (emitted by findAdopters duplicate-mode)
    name_full: { icon: '👤', es: 'Nombre completo', en: 'Full name' },
    name_word: { icon: '📝', es: 'Nombre parcial', en: 'Partial name' },
    name_word_fuzzy: { icon: '✨', es: 'Nombre similar', en: 'Similar name' },
    phone: { icon: '📱', es: 'Teléfono', en: 'Phone' },
    phone_suffix: { icon: '📞', es: 'Teléfono (sufijo)', en: 'Phone (suffix)' },
    email: { icon: '📧', es: 'Email', en: 'Email' },
    social: { icon: '🌐', es: 'Red social', en: 'Social network' },
    address_word: { icon: '📍', es: 'Dirección', en: 'Address' },
    like_fallback: { icon: '🔍', es: 'Coincidencia general', en: 'General match' },
};

export default async function ContractResultsPage({ params }: { params: Promise<{ notificationId: string }> }) {
    const { notificationId } = await params;
    let currentUser = '';
    try {
        currentUser = await getUser();
    } catch (e: any) {
        if (e?.digest?.startsWith('NEXT_REDIRECT')) throw e;
        redirect(`/?authRequired=1&callbackUrl=${encodeURIComponent(`/contract-results/${notificationId}`)}`);
    }

    const db = await getDb();
    if (!db) {
        return <ErrorState message="Database unavailable" />;
    }

    // Find notification by ID
    const notification = await db.select().from(notifications).where(eq(notifications.id, notificationId)).get();

    if (!notification) {
        return <ErrorState message="Notificación no encontrada" />;
    }

    // Security: only the recipient can view
    if (notification.userId !== currentUser) {
        return <ErrorState message="No tenés permiso para ver esta notificación" />;
    }

    // Mark as read
    await markNotificationRead(notificationId, currentUser);

    const metadata: NotificationMetadata = notification.metadata ? JSON.parse(notification.metadata) : {};

    // Fetch full adopter profiles for matches
    let matchedProfiles: Array<{ id: string; name: string; contactInfo: string | null; status: string | null }> = [];
    if (metadata.matchedAdopters && metadata.matchedAdopters.length > 0) {
        const adopterIds = metadata.matchedAdopters.map(a => a.id);
        // Filter soft-deleted (merged-duplicate) adopters at read time so even legacy
        // notifications whose stored matchedAdopters contains since-deleted IDs render correctly.
        matchedProfiles = await db
            .select({ id: adopters.id, name: adopters.name, contactInfo: adopters.contactInfo, status: adopters.status })
            .from(adopters)
            .where(and(or(...adopterIds.map(id => eq(adopters.id, id)))!, isNull(adopters.deletedAt)))
            .all();
    }

    const hasMatches = metadata.matchCount > 0;
    const submitted = metadata.submittedData;

    return (
        <main className="container mx-auto px-4 py-8 max-w-2xl">
            {/* Header */}
            <div className="mb-6">
                <Link href="/" className="text-sm text-stone-500 hover:text-stone-600 transition-colors">
                    ← Volver
                </Link>
                <h1 className="text-xl font-semibold text-stone-800 mt-2">
                    {hasMatches ? '⚠️' : '✅'} Resultados del contrato
                </h1>
                <p className="text-sm text-stone-500 mt-1">
                    {metadata.animalName} — adoptado por {metadata.adopterName}
                </p>
            </div>

            {/* Status Banner */}
            <div className={`rounded-xl p-4 mb-6 ${hasMatches ? 'bg-amber-50 border border-amber-200' : 'bg-teal-50 border border-teal-200'}`}>
                <p className={`text-sm font-semibold ${hasMatches ? 'text-amber-800' : 'text-teal-800'}`}>
                    {hasMatches
                        ? `Se encontraron ${metadata.matchCount} posible${metadata.matchCount > 1 ? 's' : ''} coincidencia${metadata.matchCount > 1 ? 's' : ''}`
                        : 'No se encontraron registros previos para este adoptante'
                    }
                </p>
                <p className={`text-xs mt-1 ${hasMatches ? 'text-amber-600' : 'text-teal-700'}`}>
                    {hasMatches
                        ? 'Revisá los perfiles a continuación para verificar si es la misma persona.'
                        : 'Todo parece estar en orden. Este adoptante no tiene registros previos en el sistema.'
                    }
                </p>
            </div>

            {/* Submitted Data */}
            {submitted && (
                <div className="bg-white rounded-xl border border-stone-200 p-4 mb-6 shadow-sm">
                    <h2 className="text-sm font-semibold text-stone-700 mb-3">📋 Datos del contrato</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {submitted.name && <DataPill label="Nombre" value={submitted.name} />}
                        {submitted.phone && <DataPill label="Teléfono" value={submitted.phone} />}
                        {submitted.email && <DataPill label="Email" value={submitted.email} />}
                        {submitted.dni && <DataPill label="DNI" value={submitted.dni} />}
                        {submitted.address && <DataPill label="Dirección" value={submitted.address} />}
                        {submitted.socialNetworks && <DataPill label="Redes" value={submitted.socialNetworks} />}
                    </div>
                </div>
            )}

            {/* Matched Profiles */}
            {hasMatches && metadata.matchedAdopters && (
                <div className="space-y-3">
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
                                        <p className="text-sm font-semibold text-stone-800 line-clamp-2 break-words" title={profile.name}>{profile.name}</p>
                                        {profile.contactInfo && (
                                            <p className="text-xs text-stone-500 mt-0.5 line-clamp-2 break-words">{profile.contactInfo}</p>
                                        )}
                                        {/* Match reasons */}
                                        <div className="flex flex-wrap gap-1.5 mt-2">
                                            {match.matchTypes.map((type) => {
                                                const label = MATCH_TYPE_LABELS[type];
                                                return (
                                                    <span
                                                        key={type}
                                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700"
                                                    >
                                                        {label?.icon || '🔗'} {label?.es || type}
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

            {/* New Adopter Link */}
            {metadata.adopterId && (
                <div className="mt-6 pt-4 border-t border-stone-200">
                    <Link
                        href={`/adopter/${metadata.adopterId}`}
                        className="inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 font-medium transition-colors"
                    >
                        👤 Ver perfil del nuevo adoptante
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
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
