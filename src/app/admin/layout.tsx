import { auth } from "@/auth";
import { isAdminAsync, isModeratorOrAdminAsync } from "@/config/admins";
import { redirect } from 'next/navigation';
import AdminSidebar from "@/components/AdminSidebar";
import AdminEnvWarnings from "@/components/AdminEnvWarnings";
import { getAdminCounts } from "@/lib/adminCounts";

export default async function AdminLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const session = await auth();
    const email = session?.user?.email;

    // Entry gate: moderators AND admins may enter the console. The ADMIN-ONLY
    // pages are further narrowed by the (admin-only) route-group layout's
    // isAdminAsync guard — so a moderator can only reach the moderator pages.
    if (!email || !(await isModeratorOrAdminAsync(email))) {
        redirect('/');
    }
    // Drives the sidebar: admins see every section + per-item Mod/🔒 markers;
    // moderators see only the moderator sections.
    const isAdmin = await isAdminAsync(email);

    // Sidebar badges for items that need action. One query; see adminCounts.ts
    // for why only these two are counted.
    const counts = await getAdminCounts();

    return (
        <div className="min-h-screen bg-stone-100 lg:flex">
            {/* Sidebar — client component handles mobile drawer behavior */}
            <AdminSidebar isAdmin={isAdmin} counts={counts} />

            {/* Main content. NOT its own scroll pane — the document scrolls as one.
                A prior `overflow-y-auto lg:h-screen` here created a SECOND 100vh
                scroller nested under the global sticky nav, so admin screens showed
                two scrollbars. The sidebar is sticky (below) so it still stays put.
                Top padding on mobile clears the fixed admin header bar. */}
            <main className="flex-1 min-w-0 p-4 pt-28 lg:p-8 lg:pt-8">
                <AdminEnvWarnings />
                {children}
            </main>
        </div>
    );
}
