import { auth } from "@/auth";
import { cookies } from "next/headers";
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { LanguageProvider } from "@/context/LanguageContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import UserMenu from "@/components/UserMenu";
import { SessionProvider } from 'next-auth/react';
import { AuthProvider } from '@/context/AuthContext';
import LoginModal from '@/components/LoginModal';

// export const runtime = "edge"; // Commented out for local debug
export const dynamic = 'force-dynamic';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'SafeAdoption',
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
    <html lang="en">
      <body className={inter.className}>
        <SessionProvider>
          <LanguageProvider>
            <AuthProvider>
              <div className="min-h-screen flex flex-col">
                <nav className="bg-white border-b border-emerald-100/50 sticky top-0 z-50 backdrop-blur-sm bg-white/90">
                  <div className="container mx-auto px-4 h-16 flex items-center justify-between">
                    <a href="/" className="font-bold text-xl text-emerald-900">
                      SafeAdoption
                    </a>
                    <div className="flex items-center gap-4">
                      <LanguageSwitcher />
                      <div className="h-6 w-px bg-emerald-100" />
                      <UserMenu user={session?.user} isAnon={!!isAnon} />
                    </div>
                  </div>
                </nav>
                <LoginModal />
                {children}
              </div>
            </AuthProvider>
          </LanguageProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
