import type { Metadata } from 'next';

// This page is what the homepage's WhatsApp referral banner shares, so the
// link preview is an invited colleague's first impression. Setting
// `openGraph`/`twitter` here REPLACES the root layout's objects wholesale —
// images included — so the preview image must be declared again here.
const SHARE_TITLE = 'La herramienta que tu refugio necesita';
const SHARE_DESCRIPTION =
    'Verificá adoptantes, recibí formularios, enviá contratos y hacé los seguimientos, todo en un solo lugar. Gratis para rescatistas, refugios y ONGs.';
const SHARE_IMAGE = {
    url: '/images/features/og-invite.png',
    width: 1200,
    height: 630,
    alt: 'BuenAdoptante: búsqueda de un adoptante con su calificación e historial',
};

export const metadata: Metadata = {
    title: 'Funcionalidades',
    description:
        'Verificá adoptantes, recibí formularios y contratos firmados y hacé los seguimientos, todo en un solo lugar. Gratis para rescatistas, refugios y ONGs.',
    openGraph: {
        title: SHARE_TITLE,
        description: SHARE_DESCRIPTION,
        type: 'website',
        siteName: 'BuenAdoptante',
        locale: 'es_AR',
        url: 'https://buenadoptante.org/funcionalidades',
        images: [SHARE_IMAGE],
    },
    twitter: {
        card: 'summary_large_image',
        title: SHARE_TITLE,
        description: SHARE_DESCRIPTION,
        images: [SHARE_IMAGE],
    },
    alternates: {
        canonical: 'https://buenadoptante.org/funcionalidades',
    },
};

export default function FuncionalidadesLayout({ children }: { children: React.ReactNode }) {
    return children;
}
