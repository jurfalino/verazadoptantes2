import { Suspense } from 'react';
import ImportWizard from '@/components/ImportWizard';

export const runtime = 'edge';

export const metadata = {
    title: 'Import Content — BuenAdoptante',
    description: 'Extract adopter information from links, text, or images using AI',
};

export default function ImportPage() {
    return (
        <div className="min-h-screen bg-stone-50 py-8 px-4">
            <Suspense fallback={
                <div className="max-w-2xl mx-auto flex items-center justify-center py-20">
                    <span className="animate-spin text-2xl">⏳</span>
                </div>
            }>
                <ImportWizard />
            </Suspense>
        </div>
    );
}
