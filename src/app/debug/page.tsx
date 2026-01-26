import { getRequestContext } from '@cloudflare/next-on-pages';

export const runtime = 'edge';

export default async function DebugPage() {
    let output = [];

    output.push("Runtime: " + (typeof EdgeRuntime === 'string' ? 'EdgeRuntime' : 'Node'));

    try {
        const { env } = getRequestContext();
        output.push("Request Context: Loaded");
        if (env) {
            output.push("Env Keys: " + Object.keys(env).join(", "));
            // Check specific keys
            output.push("DB Binding: " + (env.DB ? "Present" : "MISSING"));
            output.push("AUTH_SECRET: " + (env.AUTH_SECRET ? "Present" : "MISSING"));
        } else {
            output.push("Env: Null");
        }
    } catch (e: any) {
        output.push("Error getting request context: " + e.message);
    }

    try {
        const { auth } = await import("@/auth"); // Dynamic import to isolate
        const session = await auth();
        output.push("Auth Session: " + (session ? "Active" : "Null"));
    } catch (e: any) {
        output.push("Auth Error: " + e.message);
        output.push("Auth Stack: " + e.stack);
    }

    return (
        <div className="p-8 font-mono bg-white text-black whitespace-pre-wrap">
            <h1 className="text-xl font-bold mb-4">Debug Diagnostics</h1>
            {output.join("\n")}
        </div>
    );
}
