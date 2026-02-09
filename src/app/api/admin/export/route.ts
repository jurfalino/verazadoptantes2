export const runtime = 'edge';
import { auth } from "@/auth";
import { isAdmin } from "@/config/admins";
import { getDb } from "@/app/actions";
import { adopters, adoptions, adopterImages, adoptionImages, adopterFlags, adopterHistory, appConfig } from "@/db/schema";
import { NextResponse } from "next/server";

export async function GET() {
    const session = await auth();
    if (!session?.user?.email || !isAdmin(session.user.email)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const db = await getDb();
    if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 500 });

    // Fetch all application tables in parallel
    const [
        adoptersData,
        adoptionsData,
        adopterImagesData,
        adoptionImagesData,
        adopterFlagsData,
        adopterHistoryData,
        appConfigData,
    ] = await Promise.all([
        db.select().from(adopters).all(),
        db.select().from(adoptions).all(),
        db.select().from(adopterImages).all(),
        db.select().from(adoptionImages).all(),
        db.select().from(adopterFlags).all(),
        db.select().from(adopterHistory).all(),
        db.select().from(appConfig).all(),
    ]);

    const exportData = {
        version: "1.0",
        exportedAt: new Date().toISOString(),
        exportedBy: session.user.email,
        tables: {
            adopters: adoptersData,
            adoptions: adoptionsData,
            adopter_images: adopterImagesData,
            adoption_images: adoptionImagesData,
            adopter_flags: adopterFlagsData,
            adopter_history: adopterHistoryData,
            app_config: appConfigData,
        },
    };

    const json = JSON.stringify(exportData, null, 2);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

    return new NextResponse(json, {
        headers: {
            'Content-Type': 'application/json',
            'Content-Disposition': `attachment; filename="buenadoptante-export-${timestamp}.json"`,
        },
    });
}
