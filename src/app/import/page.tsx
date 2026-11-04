import { Suspense } from 'react';
import ImportWizard from '@/components/ImportWizard';

export const runtime = 'edge';

export const metadata = {
    // Static metadata can't follow the viewer's locale; use the default (es).
    title: 'Importar contenido — BuenAdoptante',
    description: 'Extraé datos de adoptantes desde links, texto o imágenes con IA',
};

export default function ImportPage() {
    return (
        <div className="min-h-screen bg-stone-50 py-8 px-4">
            <Suspense fallback={
                <div className="max-w-2xl mx-auto flex items-center justify-center py-20">
                    <span className="w-8 h-8 rounded-full border-4 border-stone-200 border-t-teal-600 animate-spin" aria-hidden="true" />
                </div>
            }>
                <ImportWizard />
            </Suspense>
        </div>
    );
}
