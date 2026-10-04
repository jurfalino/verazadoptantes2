/**
 * The overview renders the metrics widget for admins only — moderators reach
 * this page too, but the metrics actions are admin-only.
 */
import { describe, it, expect, vi } from 'vitest';
import { isValidElement, type ReactNode } from 'react';

const { who } = vi.hoisted(() => ({ who: { email: null as string | null } }));
const count = () => ({ from: () => ({ where: async () => [{ count: 1 }], then: (r: (v: unknown) => unknown) => Promise.resolve([{ count: 1 }]).then(r) }) });
vi.mock('@/app/actions/_db', () => ({ getDb: async () => ({ select: count }) }));
vi.mock('@/auth', () => ({ auth: async () => (who.email ? { user: { email: who.email } } : null) }));
vi.mock('@/config/admins', () => ({ isAdminAsync: async (e: string) => e === 'admin@example.com' }));
vi.mock('@/components/admin/AdminMetricsCollapsible', () => ({ default: function MetricsWidgetSentinel() { return null; } }));

import AdminOverviewPage from './page';

function contains(node: ReactNode, name: string): boolean {
    if (Array.isArray(node)) return node.some(n => contains(n, name));
    if (!isValidElement(node)) return false;
    const t = node.type as { name?: string };
    if (typeof node.type === 'function' && t.name === name) return true;
    return contains((node.props as { children?: ReactNode }).children, name);
}

describe('admin overview — metrics widget', () => {
    it('shown to an admin', async () => {
        who.email = 'admin@example.com';
        expect(contains(await AdminOverviewPage(), 'MetricsWidgetSentinel')).toBe(true);
    });

    it('hidden from a moderator (the actions would refuse)', async () => {
        who.email = 'moderator@example.com';
        expect(contains(await AdminOverviewPage(), 'MetricsWidgetSentinel')).toBe(false);
    });
});
