import { auth } from "@/auth";
import { isAdminAsync } from "@/config/admins";
import { redirect } from 'next/navigation';
import AdminSidebar from "@/components/AdminSidebar";

export default async function AdminLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const session = await auth();

    // Secure Admin Area
    if (!session?.user?.email || !await isAdminAsync(session.user.email)) {
        redirect('/');
    }

    return (
        <div className="min-h-screen bg-stone-100 lg:flex">
            {/* Sidebar — client component handles mobile drawer behavior */}
            <AdminSidebar />

            {/* Main Content — top padding on mobile for the fixed header bar */}
            <main className="flex-1 overflow-y-auto lg:h-screen p-4 pt-28 lg:p-8 lg:pt-8">
                {children}
            </main>
        </div>
    );
}
