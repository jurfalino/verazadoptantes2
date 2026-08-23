import { auth } from "@/auth";
import { isAdminAsync } from "@/config/admins";
import { redirect } from 'next/navigation';
import AdminSidebar from "@/components/AdminSidebar";
import AdminEnvWarnings from "@/components/AdminEnvWarnings";

export default async function AdminLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const session = await auth();
    const email = session?.user?.email;
    const isAdmin = !!email && await isAdminAsync(email);

    // Secure Admin Area. Admin-only for now — to enable moderator access, loosen
    // this to isModeratorOrAdminAsync AND gate each admin-only page server-side
    // (most are client components, so a middleware/route-group guard, not a
    // per-page check). `isAdmin` is passed to the sidebar so its nav filters
    // per role and shows the Mod/🔒 markers for admins.
    if (!email || !isAdmin) {
        redirect('/');
    }

    return (
        <div className="min-h-screen bg-stone-100 lg:flex">
            {/* Sidebar — client component handles mobile drawer behavior */}
            <AdminSidebar isAdmin={isAdmin} />

            {/* Main Content — top padding on mobile for the fixed header bar */}
            <main className="flex-1 overflow-y-auto lg:h-screen p-4 pt-28 lg:p-8 lg:pt-8">
                <AdminEnvWarnings />
                {children}
            </main>
        </div>
    );
}
