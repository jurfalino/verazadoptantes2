import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Preguntas Frecuentes sobre Adopción',
    description:
        'Respuestas a las preguntas más comunes sobre el proceso de verificación de adoptantes y adopción responsable de animales.',
    openGraph: {
        title: 'Preguntas Frecuentes — BuenAdoptante',
        description:
            'Todo lo que necesitás saber sobre el proceso de adopción responsable.',
        type: 'website',
    },
    alternates: {
        canonical: 'https://buenadoptante.org/guia/faq',
    },
};

export default function FaqLayout({ children }: { children: React.ReactNode }) {
    return children;
}
