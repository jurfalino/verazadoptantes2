import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Organizaciones',
    robots: {
        index: false,
    },
};

export default function OrganizationsLayout({ children }: { children: React.ReactNode }) {
    return children;
}
