/**
 * Tell the admins someone asked for API access (from /developers: the request
 * form, or their first key). Runs after the response; logged, never thrown.
 */
import { runAfterResponse } from '@/lib/background';
import { logAudit } from '@/lib/audit';

export async function announceAccessRequest(email: string, tool: string): Promise<void> {
    logAudit({ userEmail: email, action: 'api_access_requested', details: { tool: tool.slice(0, 120) } });
    await runAfterResponse('api.accessRequest.notifyAdmins', async () => {
        const { notifyAdmins } = await import('@/app/actions/notifications');
        await notifyAdmins({
            actorEmail: email, type: 'api_access_requested', title: 'Pedido de acceso a la API',
            body: `${email} pidió acceso a la API (${tool.slice(0, 80)}). Su clave ya funciona con el límite inicial; aprobalo para subirlo.`,
            url: '/admin/api?tab=people&status=requested',
        });
    }, { user: email });
}
