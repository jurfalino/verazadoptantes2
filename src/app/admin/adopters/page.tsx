export const runtime = 'edge';
import { getDb } from "@/app/actions";
import { adopters, adopterFlags, adopterHistory, adopterImages, adopterStats, adoptions, adoptionImages } from "@/db/schema";
import { desc, like, or, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { logger } from "@/lib/logger";

// Admin emails - should match the ones in actions.ts
const ADMIN_EMAILS = ['jurfalino@gmail.com'];

async function handleDeleteAdopter(formData: FormData) {
    'use server';

    const adopterId = formData.get('adopterId') as string;
    if (!adopterId) {
        logger.warn('Delete attempt with no adopterId');
        return;
    }

    try {
        const session = await auth();

        // Debug: log session info
        logger.info('Delete attempt debug', {
            adopterId,
            hasSession: !!session,
            userEmail: session?.user?.email || 'no-email',
            isAdmin: session?.user?.email ? ADMIN_EMAILS.includes(session.user.email) : false
        });

        if (!session?.user?.email || !ADMIN_EMAILS.includes(session.user.email)) {
            logger.warn('Unauthorized delete attempt', {
                adopterId,
                email: session?.user?.email || 'no-session'
            });
            return;
        }

        const db = await getDb();
        if (!db) {
            logger.error('No database for delete', null, { adopterId });
            return;
        }

        // Get all adoption IDs for this adopter first (to delete their images)
        const adopterAdoptions = await db.select({ id: adoptions.id })
            .from(adoptions)
            .where(eq(adoptions.adopterId, adopterId));
        const adoptionIds = adopterAdoptions.map((a: { id: string }) => a.id);

        // Cascade Logic
        await db.delete(adopterStats).where(eq(adopterStats.adopterId, adopterId));
        await db.delete(adopterFlags).where(eq(adopterFlags.adopterId, adopterId));
        await db.delete(adopterHistory).where(eq(adopterHistory.adopterId, adopterId));
        await db.delete(adopterImages).where(eq(adopterImages.adopterId, adopterId));

        if (adoptionIds.length > 0) {
            await db.delete(adoptionImages).where(inArray(adoptionImages.adoptionId, adoptionIds));
        }

        await db.delete(adoptions).where(eq(adoptions.adopterId, adopterId));
        await db.delete(adopters).where(eq(adopters.id, adopterId));

        logger.info('Adopter deleted', { adopterId, deletedBy: session.user.email });
        revalidatePath('/admin/adopters');
    } catch (error) {
        console.error("Delete adopter error:", error);
        logger.error('Delete adopter failed', error, { adopterId });
    }
}

export default async function AdminAdoptersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
    const db = await getDb();
    if (!db) return <div>DB Unavailable</div>;

    const { q } = await searchParams;
    const query = q || '';

    const list = await db.select()
        .from(adopters)
        .where(
            query ? or(
                like(adopters.name, `%${query}%`),
                like(adopters.id, `%${query}%`)
            ) : undefined
        )
        .orderBy(desc(adopters.updatedAt))
        .limit(50);

    return (
        <div className="max-w-6xl mx-auto space-y-6">
            <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold text-stone-900">Manage Adopters</h2>
                <form className="flex gap-2">
                    <input
                        name="q"
                        defaultValue={query}
                        placeholder="Search name or ID..."
                        className="px-4 py-2 rounded-lg border border-stone-200 text-sm w-64"
                    />
                    <button type="submit" className="px-4 py-2 bg-stone-900 text-white rounded-lg text-sm font-bold">Search</button>
                </form>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-stone-200 overflow-hidden">
                <table className="w-full text-left">
                    <thead className="bg-stone-50 border-b border-stone-100">
                        <tr>
                            <th className="p-4 font-bold text-stone-500 text-sm">Name</th>
                            <th className="p-4 font-bold text-stone-500 text-sm">Contact</th>
                            <th className="p-4 font-bold text-stone-500 text-sm">Status</th>
                            <th className="p-4 font-bold text-stone-500 text-sm text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                        {list.map((adopter: typeof adopters.$inferSelect) => (
                            <tr key={adopter.id} className="hover:bg-stone-50/50">
                                <td className="p-4">
                                    <div className="font-bold text-stone-900">{adopter.name}</div>
                                    <div className="text-xs text-stone-400 font-mono">{adopter.id}</div>
                                </td>
                                <td className="p-4 text-sm text-stone-600 max-w-xs truncate">
                                    {adopter.contactInfo || '-'}
                                </td>
                                <td className="p-4">
                                    <span className="inline-flex px-2 py-1 rounded-full text-xs font-bold bg-stone-100 text-stone-700">
                                        Rating: {adopter.status}
                                    </span>
                                </td>
                                <td className="p-4 text-right space-x-2">
                                    <Link
                                        href={`/adopter/${adopter.id}`}
                                        target="_blank"
                                        className="px-3 py-1.5 text-xs font-bold text-teal-600 bg-teal-50 rounded-lg hover:bg-teal-100"
                                    >
                                        Edit
                                    </Link>
                                    <form action={handleDeleteAdopter} className="inline-block">
                                        <input type="hidden" name="adopterId" value={adopter.id} />
                                        <button
                                            type="submit"
                                            className="px-3 py-1.5 text-xs font-bold text-rose-600 bg-rose-100 rounded-lg hover:bg-rose-200 transition-colors"
                                            title="Permanently Delete Adopter"
                                        >
                                            Delete
                                        </button>
                                    </form>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

