import type { Metadata } from 'next';
import { GuideHowToJsonLd } from '@/components/JsonLd';
import { STEPS } from '@/content/guide-data';

export const metadata: Metadata = {
    title: 'Guía de Adopción Responsable',
    description:
        '6 fases para verificar adoptantes de animales y garantizar adopciones responsables. Guía completa de la comunidad rescatista.',
    openGraph: {
        title: 'Guía de Adopción Responsable — BuenAdoptante',
        description:
            '6 fases para verificar adoptantes de animales y garantizar adopciones responsables.',
        type: 'website',
    },
    twitter: {
        card: 'summary_large_image',
        title: 'Guía de Adopción Responsable — BuenAdoptante',
        description:
            '6 fases para verificar adoptantes de animales y garantizar adopciones responsables.',
    },
    alternates: {
        canonical: 'https://buenadoptante.org/guia',
    },
};

export default function GuiaLayout({ children }: { children: React.ReactNode }) {
    // Some phases carry no standalone description — they open straight into their
    // steps — so fall back to the first one rather than emitting an empty
    // HowToStep description. The `**` emphasis markers are stripped: this is
    // structured data, not rendered copy.
    const howToSteps = STEPS.map((s) => ({
        name: s.entry.titleEs,
        description: (s.entry.descriptionEs || s.entry.details?.[0]?.textEs || s.entry.titleEs)
            .replace(/\*\*/g, ''),
    }));
    return (
        <>
            <GuideHowToJsonLd steps={howToSteps} />
            {children}
        </>
    );
}
