/**
 * Reusable JSON-LD structured data component for SEO and GEO (Generative Engine Optimization).
 * Renders a <script type="application/ld+json"> tag with the provided schema.
 */
import { version as PKG_VERSION } from '../../package.json';

type JsonLdProps = {
    data: Record<string, unknown>;
};

export function JsonLd({ data }: JsonLdProps) {
    return (
        <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
        />
    );
}

/** WebApplication schema for the root layout — tells LLMs what this app IS */
export function WebApplicationJsonLd() {
    return (
        <JsonLd
            data={{
                '@context': 'https://schema.org',
                '@type': 'WebApplication',
                'name': 'BuenAdoptante',
                'url': 'https://buenadoptante.org',
                'description':
                    'Plataforma colaborativa para verificar adoptantes de animales y garantizar hogares seguros. Collaborative platform to vet pet adopters and ensure safe homes.',
                'applicationCategory': 'LifestyleApplication',
                'operatingSystem': 'Web',
                'offers': {
                    '@type': 'Offer',
                    'price': '0',
                    'priceCurrency': 'ARS',
                },
                'author': {
                    '@type': 'Organization',
                    'name': 'BuenAdoptante',
                    'url': 'https://buenadoptante.org',
                    'email': 'privacidad@buenadoptante.org',
                    'description':
                        'Plataforma sin fines de lucro de la comunidad rescatista argentina para proteger el bienestar animal.',
                },
                'inLanguage': ['es', 'en'],
                'featureList': [
                    'Búsqueda de adoptantes con historial compartido entre refugios',
                    'Registro de adopciones con calificación, fotos y observaciones',
                    'Importación automática desde publicaciones de Facebook e Instagram',
                    'Contratos de adopción digitales con firma y PDF',
                    'Alertas y banderas de advertencia comunitarias',
                    'Extracción automática de datos con inteligencia artificial (Gemini)',
                    'Sistema de notificaciones in-app',
                    'Aplicación web progresiva (PWA) con soporte offline',
                ],
                'screenshot': 'https://buenadoptante.org/og-image.png',
                'softwareVersion': PKG_VERSION,
            }}
        />
    );
}

/** Organization schema — E-E-A-T signal for search engines */
export function OrganizationJsonLd() {
    return (
        <JsonLd
            data={{
                '@context': 'https://schema.org',
                '@type': 'Organization',
                'name': 'BuenAdoptante',
                'url': 'https://buenadoptante.org',
                'logo': 'https://buenadoptante.org/icon.svg',
                'email': 'privacidad@buenadoptante.org',
                'description':
                    'Plataforma colaborativa sin fines de lucro para la verificación de adoptantes de animales en Argentina.',
                'foundingLocation': {
                    '@type': 'Place',
                    'name': 'Buenos Aires, Argentina',
                },
            }}
        />
    );
}

/** HowTo schema for the guide page */
export function GuideHowToJsonLd({
    steps,
}: {
    steps: { name: string; description: string }[];
}) {
    return (
        <JsonLd
            data={{
                '@context': 'https://schema.org',
                '@type': 'HowTo',
                'name': 'Cómo verificar adoptantes de animales — Guía completa',
                'description':
                    '6 fases para garantizar que cada animal llegue al hogar correcto y se quede ahí.',
                'step': steps.map((step, i) => ({
                    '@type': 'HowToStep',
                    'position': i + 1,
                    'name': step.name,
                    'text': step.description,
                })),
            }}
        />
    );
}

/** FAQPage schema for the FAQ page */
export function FaqPageJsonLd({
    faqs,
}: {
    faqs: { question: string; answer: string }[];
}) {
    return (
        <JsonLd
            data={{
                '@context': 'https://schema.org',
                '@type': 'FAQPage',
                'mainEntity': faqs.map((faq) => ({
                    '@type': 'Question',
                    'name': faq.question,
                    'acceptedAnswer': {
                        '@type': 'Answer',
                        'text': faq.answer,
                    },
                })),
            }}
        />
    );
}
