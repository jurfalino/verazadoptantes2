// eximport { auth } from "@/auth";

export const runtime = 'edge';

export default async function DebugPage() {
    return (
        <div className="p-8 font-mono bg-white text-black">
            <h1 className="text-xl font-bold">Sanity Check: Passed</h1>
            <p>If you can see this, the Edge Runtime is functional.</p>
        </div>
    );
}
