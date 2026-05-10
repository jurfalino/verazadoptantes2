import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Notificaciones',
    robots: {
        index: false,
    },
};

export default function NotificacionesLayout({ children }: { children: React.ReactNode }) {
    return children;
}
