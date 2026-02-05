import { auth } from "@/auth";
import { cookies } from "next/headers";
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { LanguageProvider } from "@/context/LanguageContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeSelector } from "@/components/ThemeSelector";
import { Logo } from "@/components/Logo";
import UserMenu from "@/components/UserMenu";
import { SessionProvider } from 'next-auth/react';
import { AuthProvider } from '@/context/AuthContext';
import LoginModal from '@/components/LoginModal';

export const runtime = "edge";
export const dynamic = 'force-dynamic';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'BuenAdoptante',
  description: 'Vet pet adopters and ensure safe homes.',
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
    console.error("Layout Auth Error:", e);
  }

  const cookieStore = await cookies();
  const isAnon = cookieStore.get("anon_user");

  return (
    <html lang="es" suppressHydrationWarning>
      <body className={inter.className}>
        <SessionProvider refetchOnWindowFocus={true} refetchInterval={5 * 60}>
          <LanguageProvider>
            <ThemeProvider>
              <AuthProvider>
                <div className="min-h-screen flex flex-col bg-stone-50">
                  <nav className="bg-white/80 border-b border-stone-200 sticky top-0 z-50 backdrop-blur-md">
                    <div className="container mx-auto px-4 h-16 flex items-center justify-between">
                      <Logo />
                      <div className="flex items-center gap-3">
                        <ThemeSelector />
                        <LanguageSwitcher />
                        <div className="h-6 w-px bg-stone-200" />
                        <UserMenu user={session?.user} isAnon={!!isAnon} />
                      </div>
                    </div>
                  </nav>
                  <LoginModal />
                  {children}
                </div>
              </AuthProvider>
            </ThemeProvider>
          </LanguageProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
