// /developers (Jon, 2026-10-17): the API's public entry — docs, and for a
// signed-in user, their own keys (self-service, after accepting the API terms).
// Hidden (404) while the API is off.
import { notFound } from 'next/navigation';
import { getFeatureFlag } from '@/config/features';
import DevelopersClient from '@/components/api/DevelopersClient';

export const runtime = 'edge';

export const metadata = { title: 'API para desarrolladores — BuenAdoptante' };

export default async function DevelopersPage() {
    if (!(await getFeatureFlag('ENABLE_PUBLIC_API'))) notFound();
    return <DevelopersClient />;
}
