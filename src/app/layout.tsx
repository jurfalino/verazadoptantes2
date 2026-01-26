import { auth } from "@/auth";
export const runtime = "edge";
import Login from "@/components/Login";
import { cookies } from "next/headers";
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { LanguageProvider } from "@/context/LanguageContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

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
  let session = null;
  try {
    session = await auth();
  } catch (e) {
    console.error("Layout Auth Error:", e);
  }
  const cookieStore = await cookies();
  const isAnon = cookieStore.get("anon_user");
  const isAuthenticated = !!session?.user || !!isAnon;

  return (
    <html lang="en">
      <body className={inter.className}>
        <LanguageProvider>
          {isAuthenticated ? (
            <div className="min-h-screen flex flex-col">
              <nav className="bg-white border-b border-emerald-100/50 sticky top-0 z-50 backdrop-blur-sm bg-white/90">
                <div className="container mx-auto px-4 h-16 flex items-center justify-between">
                  <a href="/" className="font-bold text-xl text-emerald-900">
                    SafeAdoption
                  </a>
                  <div className="flex items-center gap-4">
                    <LanguageSwitcher />
                    <div className="h-6 w-px bg-emerald-100" />
                    {session?.user ? (
                      <div className="flex items-center gap-2">
                        {session.user.image && <img src={session.user.image} className="w-8 h-8 rounded-full border border-emerald-200" alt="Avatar" />}
                        <span className="text-sm font-medium text-emerald-900 hidden md:block">{session.user.name}</span>
                      </div>
                    ) : (
                      <span className="text-xs font-mono bg-emerald-50 text-emerald-600 px-2 py-1 rounded">Anonymous Mode</span>
                    )}
                  </div>
                </div>
              </nav>
              {children}
            </div>
          ) : (
            <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
              <div className="w-full max-w-md">
                <div className="text-center mb-10">
                  <h1 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-emerald-500 to-teal-600 mb-2">
                    SafeAdoption
                  </h1>
                  <p className="text-gray-500">The single source of truth for pet adoptions.</p>
                </div>
                <Login />
              </div>
            </main>
          )}
        </LanguageProvider>
      </body>
    </html>
  );
}
