import { getDb } from '@/lib/db';
import { organizations } from '@/db/schema';
import { eq } from 'drizzle-orm';

export const runtime = 'edge';

export async function GET(_req: Request, { params }: { params: Promise<{ orgId: string }> }) {
    const { orgId } = await params;

    let orgName = 'Organización';
    try {
        const db = await getDb();
        if (db) {
            const org = await db.select().from(organizations).where(eq(organizations.id, orgId)).get();
            if (org) orgName = org.name;
        }
    } catch { /* best effort */ }

    // Generate SVG badge
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="60" viewBox="0 0 320 60">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#0d9488"/>
      <stop offset="100%" stop-color="#0f766e"/>
    </linearGradient>
  </defs>
  <rect width="320" height="60" rx="8" fill="url(#g)"/>
  <text x="12" y="24" fill="white" font-family="-apple-system,system-ui,sans-serif" font-weight="bold" font-size="14">✅ Registro Verificado</text>
  <text x="12" y="44" fill="rgba(255,255,255,0.75)" font-family="-apple-system,system-ui,sans-serif" font-size="12">${escapeXml(orgName)} · buenadoptante.org</text>
</svg>`;

    return new Response(svg, {
        headers: {
            'Content-Type': 'image/svg+xml',
            'Cache-Control': 'public, max-age=86400',
        },
    });
}

function escapeXml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
