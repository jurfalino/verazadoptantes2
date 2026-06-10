import { auth } from "@/auth";
import { logger } from "@/lib/logger";
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { LanguageProvider } from "@/context/LanguageContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { Logo } from "@/components/Logo";
import UserMenu from "@/components/UserMenu";
import { SessionProvider } from 'next-auth/react';
import { AuthProvider } from '@/context/AuthContext';
import LoginModal from '@/components/LoginModal';
import { ToastProvider } from '@/components/ui/Toast';
import ClientErrorReporter from '@/components/ClientErrorReporter';
import InstallPrompt from '@/components/InstallPrompt';
import Footer from '@/components/Footer';
import { CountryConfirmBanner } from '@/components/CountryConfirmBanner';
import NotificationBell from '@/components/NotificationBell';
import ZarazIdentify from '@/components/ZarazIdentify';
import ClarityScript from '@/components/ClarityScript';
import { WebApplicationJsonLd, OrganizationJsonLd } from '@/components/JsonLd';
import ChatWidget from '@/components/ChatWidget';
import { getFeatureFlag } from '@/config/features';

export const runtime = "edge";
export const dynamic = 'force-dynamic';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  metadataBase: new URL('https://buenadoptante.org'),
  title: {
    default: 'BuenAdoptante — Registro de Adopciones',
    template: '%s | BuenAdoptante',
  },
  description:
    'Buscá, verificá y reportá adoptantes para asegurar que cada mascota llegue al hogar que merece. Plataforma colaborativa de la comunidad rescatista.',
  keywords: [
    'adopción responsable',
    'verificar adoptantes',
    'bienestar animal',
    'rescate animal',
    'adoptar mascotas',
    'pet adoption vetting',
    'animal rescue community',
    'BuenAdoptante',
  ],
  authors: [{ name: 'BuenAdoptante', url: 'https://buenadoptante.org' }],
  creator: 'BuenAdoptante',
  openGraph: {
    type: 'website',
    locale: 'es_AR',
    alternateLocale: 'en_US',
    url: 'https://buenadoptante.org',
    siteName: 'BuenAdoptante',
    title: 'BuenAdoptante — Registro de Adopciones',
    description:
      'Buscá, verificá y reportá adoptantes para asegurar que cada mascota llegue al hogar que merece.',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'BuenAdoptante — Registro de Adopciones Responsables',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'BuenAdoptante — Registro de Adopciones',
    description:
      'Buscá, verificá y reportá adoptantes para asegurar que cada mascota llegue al hogar que merece.',
    images: ['/og-image.png'],
  },
  alternates: {
    canonical: 'https://buenadoptante.org',
  },
  category: 'lifestyle',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let session: any = null;

  try {
    session = await auth();
  } catch (e) {
    logger.warn('Layout auth check failed', { error: e instanceof Error ? e.message : String(e) });
  }

  // Feature flag for the floating support chat. Reads DB → env → default.
  // Falls open to false if the flag lookup fails so the widget can't
  // accidentally appear on misconfigured deployments.
  let chatEnabled = false;
  try {
    chatEnabled = await getFeatureFlag('ENABLE_CHAT_WIDGET');
  } catch (e) {
    logger.warn('Layout chat-flag lookup failed', { error: e instanceof Error ? e.message : String(e) });
  }


  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        {/* Early theme injection to prevent FOUC and ensure theme loads before React */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var theme = localStorage.getItem('theme');
                  if (theme === 'apple') { theme = 'light'; localStorage.setItem('theme', 'light'); }
                  if (theme && ['light', 'dark'].includes(theme)) {
                    document.documentElement.setAttribute('data-theme', theme);
                  }
                } catch (e) {}
              })();
            `,
          }}
        />
        {/* PWA */}
        <link rel="manifest" href="/manifest.json" />
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <meta name="theme-color" content="#292524" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        {/* Structured Data — JSON-LD for SEO and AI citability */}
        <WebApplicationJsonLd />
        <OrganizationJsonLd />
      </head>
      <body className={inter.className}>
        <SessionProvider session={session ?? undefined} refetchOnWindowFocus={true} refetchInterval={5 * 60}>
          <ZarazIdentify />
          <ClarityScript />
          <LanguageProvider>
            <ThemeProvider>
              <ToastProvider>
                <ClientErrorReporter />
                <AuthProvider>
                  <div className="min-h-screen flex flex-col bg-stone-50">
                    <nav className="bg-white/80 border-b border-stone-200 sticky top-0 z-50 backdrop-blur-md">
                      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
                        <Logo />
                        <div className="flex items-center gap-1 sm:gap-2">
                          <NotificationBell />
                          <UserMenu user={session?.user} isAdmin={(session?.user as { isAdmin?: boolean } | undefined)?.isAdmin} />
                        </div>
                      </div>
                    </nav>
                    <CountryConfirmBanner key={session?.user?.email || 'anon'} userEmail={session?.user?.email || null} />
                    <LoginModal />
                    <InstallPrompt />
                    {children}
                    <Footer />
                  </div>
                  {chatEnabled && <ChatWidget />}
                </AuthProvider>
              </ToastProvider>
            </ThemeProvider>
          </LanguageProvider>
        </SessionProvider>
        {/* Service Worker Registration.
            The .catch is load-bearing: register() can reject for reasons we
            don't control (browser denies, extension-shimmed wrapper, PWA
            permission gate, transient install race). Without it, the
            rejection becomes an unhandled-rejection caught by
            ClientErrorReporter and surfaces as a generic "Algo salió mal"
            toast to the user (v2.16.0-35) — SW is an offline-cache nicety
            and should never user-visibly fail. Console.warn keeps the
            signal for debugging without polluting the UX. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', function() {
                  navigator.serviceWorker.register('/sw.js').catch(function(err) {
                    console.warn('[sw] registration failed:', err);
                  });
                });
              }
            `,
          }}
        />
      </body>
    </html>
  );
}
