export const runtime = 'edge';
import { notFound, redirect } from 'next/navigation';
import { getFeatureFlag } from '@/config/features';
import { getInterview } from '@/app/actions/interviews';
import { logger } from '@/lib/logger';
import InterviewReadOnly from '@/components/interview/InterviewReadOnly';

export const metadata = { title: 'Entrevista' };

export default async function InterviewDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const enabled = await getFeatureFlag('ENABLE_INTERVIEW_GUIDE').catch((e) => {
        logger.warn('interview page: flag read failed', { error: e instanceof Error ? e.message : String(e) });
        return false;
    });
    if (!enabled) notFound();
    const { auth } = await import('@/auth');
    const session = await auth();
    if (!session?.user?.email) redirect(`/?authRequired=1&callbackUrl=${encodeURIComponent(`/interview/${id}`)}`);
    const r = await getInterview(id);
    if (!r.ok) notFound();
    if (r.view.status === 'draft') redirect(`/interview?resume=${encodeURIComponent(id)}`);
    return (
        <div className="min-h-screen bg-stone-50 py-6">
            <InterviewReadOnly view={r.view} />
        </div>
    );
}
