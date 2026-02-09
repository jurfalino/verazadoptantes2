import { auth } from "@/auth";
import { isAdmin } from "@/config/admins";
import Link from 'next/link';
import { redirect } from 'next/navigation';

export default async function AdminLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const session = await auth();

    // Secure Admin Area
    if (!session?.user?.email || !isAdmin(session.user.email)) {
        redirect('/');
    }

    return (
        <div className="min-h-screen bg-stone-100 flex">
            {/* Sidebar */}
            <aside className="w-64 bg-stone-900 text-stone-300 flex-shrink-0">
                <div className="p-6">
                    <h1 className="text-xl font-bold text-white tracking-tight">Admin Console</h1>
                    <p className="text-xs text-stone-500 mt-1">v1.8.0</p>
                </div>
                <nav className="mt-6 px-4 space-y-2">
                    <Link
                        href="/admin"
                        className="block px-4 py-2 rounded-lg hover:bg-stone-800 hover:text-white transition-colors"
                    >
                        Overview
                    </Link>
                    <Link
                        href="/admin/flags"
                        className="block px-4 py-2 rounded-lg hover:bg-stone-800 hover:text-white transition-colors"
                    >
                        Flagged Content
                    </Link>
                    <Link
                        href="/admin/adopters"
                        className="block px-4 py-2 rounded-lg hover:bg-stone-800 hover:text-white transition-colors"
                    >
                        Adopters List
                    </Link>
                    <Link
                        href="/admin/query"
                        className="block px-4 py-2 rounded-lg hover:bg-stone-800 hover:text-white transition-colors text-amber-500/80 hover:text-amber-400"
                    >
                        SQL Runner
                    </Link>
                    <Link
                        href="/admin/config"
                        className="block px-4 py-2 rounded-lg hover:bg-stone-800 hover:text-white transition-colors"
                    >
                        ⚙️ Configuration
                    </Link>
                    <Link
                        href="/admin/data-requests"
                        className="block px-4 py-2 rounded-lg hover:bg-stone-800 hover:text-white transition-colors"
                    >
                        📬 Data Requests
                    </Link>

                    <div className="pt-8 mt-8 border-t border-stone-800">
                        <Link
                            href="/"
                            className="block px-4 py-2 rounded-lg hover:bg-stone-800 hover:text-white transition-colors text-sm"
                        >
                            ← Back to App
                        </Link>
                    </div>
                </nav>
            </aside>

            {/* Main Content */}
            <main className="flex-1 overflow-y-auto h-screen p-8">
                {children}
            </main>
        </div>
    );
}
