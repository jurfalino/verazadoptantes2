import type { Metadata } from 'next';
import { FaqPageJsonLd } from '@/components/JsonLd';
import { FAQ } from '@/content/guide-data';

export const metadata: Metadata = {
    title: 'Preguntas Frecuentes',
    description:
        'Qué es BuenAdoptante, cómo ayuda a la comunidad rescatista y cómo protege la información de los adoptantes. Respuestas a las preguntas más comunes de quienes empiezan.',
    openGraph: {
        title: 'Preguntas Frecuentes — BuenAdoptante',
        description:
            'Qué es BuenAdoptante, cómo te ayuda y cómo protege los datos de los adoptantes.',
        type: 'website',
    },
    twitter: {
        card: 'summary_large_image',
        title: 'Preguntas Frecuentes — BuenAdoptante',
        description:
            'Qué es BuenAdoptante, cómo te ayuda y cómo protege los datos de los adoptantes.',
    },
    alternates: {
        canonical: 'https://buenadoptante.org/faq',
    },
};

export default function FaqLayout({ children }: { children: React.ReactNode }) {
    const faqs = FAQ.map((f) => ({
        question: f.entry.questionEs,
        // Strip the **bold** markers and line-leading bullet markers, and
        // collapse paragraph breaks, so the structured data carries clean
        // plain text (not markdown/newlines/dashes).
        answer: f.entry.answerEs
            .replace(/\*\*/g, '')
            .replace(/^[ \t]*[-•][ \t]+/gm, '')
            .replace(/\s*\n+\s*/g, ' '),
    }));
    return (
        <>
            <FaqPageJsonLd faqs={faqs} />
            {children}
        </>
    );
}
