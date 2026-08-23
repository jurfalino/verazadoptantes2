import { auth } from "@/auth";
import { isAdminAsync } from "@/config/admins";
import { redirect } from 'next/navigation';

/**
 * Server gate for the ADMIN-ONLY subset of the console. The parent
 * `admin/layout.tsx` already admits moderators + admins; this nested
 * route-group layout narrows the pages under it to admins only.
 *
 * A route group `(admin-only)` keeps every URL unchanged (`/admin/users`,
 * `/admin/config`, …) — it exists solely to attach this guard. It's a SERVER
 * boundary, so it protects the many admin-only pages that are client
 * components (which can't run their own async auth check). Uses the canonical
 * `isAdminAsync` (bootstrap list + DB role), not the session `isAdmin` flag,
 * so bootstrap admins aren't wrongly blocked. A moderator who reaches an
 * admin-only URL is sent back to the overview they can see.
 */
export default async function AdminOnlyLayout({ children }: { children: React.ReactNode }) {
    const email = (await auth())?.user?.email;
    if (!email || !(await isAdminAsync(email))) {
        redirect('/admin');
    }
    return <>{children}</>;
}
