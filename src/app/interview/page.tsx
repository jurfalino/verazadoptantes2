export const runtime = 'edge';
import { notFound, redirect } from 'next/navigation';
import { getFeatureFlag } from '@/config/features';
import { listMyInterviewDrafts } from '@/app/actions/interviews';
import { logger } from '@/lib/logger';
import InterviewApp from '@/components/interview/InterviewApp';

export const metadata = { title: 'Entrevista' };

export default async function InterviewPage({ searchParams }: { searchParams: Promise<{ adopterId?: string; resume?: string }> }) {
    const enabled = await getFeatureFlag('ENABLE_INTERVIEW_GUIDE').catch((e) => {
        logger.warn('interview page: flag read failed', { error: e instanceof Error ? e.message : String(e) });
        return false;
    });
    if (!enabled) notFound();
    const { auth } = await import('@/auth');
    const session = await auth();
    if (!session?.user?.email) redirect(`/?authRequired=1&callbackUrl=${encodeURIComponent('/interview')}`);
    const sp = await searchParams;
    const drafts = await listMyInterviewDrafts();
    return (
        <div className="min-h-screen bg-stone-50 py-6">
            <InterviewApp
                initialDrafts={drafts.ok ? drafts.drafts : []}
                fromAdopterId={sp.adopterId ?? null}
                resumeId={sp.resume ?? null}
            />
        </div>
    );
}
