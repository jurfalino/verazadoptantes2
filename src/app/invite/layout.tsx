import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Invitación a Organización',
    description:
        'Te invitaron a unirte a una organización en BuenAdoptante. Aceptá la invitación para colaborar con tu equipo.',
    openGraph: {
        title: 'Te invitaron a unirte — BuenAdoptante',
        description:
            'Aceptá la invitación para unirte a una organización y colaborar con tu equipo de rescate.',
        type: 'website',
    },
    twitter: {
        card: 'summary_large_image',
        title: 'Te invitaron a unirte — BuenAdoptante',
        description:
            'Aceptá la invitación para unirte a una organización y colaborar con tu equipo de rescate.',
    },
    robots: {
        index: false, // Don't index invite pages
    },
};

export default function InviteLayout({ children }: { children: React.ReactNode }) {
    return children;
}
