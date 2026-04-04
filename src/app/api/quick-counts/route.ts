import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getDb } from '@/app/actions';
import { adoptions, adopters } from '@/db/schema';
import { eq, and, isNull, inArray, sql, count, not } from 'drizzle-orm';
import { getFeatureFlag } from '@/config/features';
import { getOrgMemberEmails } from '@/app/actions/organizations';
import { logger } from '@/lib/logger';

export const runtime = 'edge';

export async function GET() {
    const session = await auth();
    if (!session?.user?.email) {
        return NextResponse.json({ animals: 0, adoptions: 0, adopters: 0 }, { status: 401 });
    }

    try {
        const db = await getDb();
        if (!db) {
            return NextResponse.json({ animals: 0, adoptions: 0, adopters: 0 }, { status: 500 });
        }

        const memberEmails = await getOrgMemberEmails();
        
        // 1. My Adopters (all adopters created by org members)
        const [adopterCount] = await db.select({ value: count() })
            .from(adopters)
            .where(inArray(adopters.addedBy, memberEmails));

        // 2. My Adoptions (all adoptions where recordType != 'available')
        // Using same logic as getMyAdoptions('all')
        const [adoptionCount] = await db.select({ value: count() })
            .from(adoptions)
            .where(and(
                inArray(adoptions.addedBy, memberEmails),
                not(eq(adoptions.recordType, 'available'))
            ));

        // 3. My Animals (Pending)
        let animalCount = { value: 0 };
        const animalsEnabled = await getFeatureFlag('ENABLE_ANIMALS_FOR_ADOPTION');
        
        if (animalsEnabled) {
            // Using logic from api/my-animals ?view=available
            const [ac] = await db.select({ value: count() })
                .from(adoptions)
                .where(and(
                    eq(adoptions.addedBy, session.user.email), // animals are usually personal, not org scope in my-animals route
                    isNull(adoptions.adopterId),
                    eq(adoptions.recordType, 'available')
                ));
            animalCount = ac;
        }

        return NextResponse.json({
            animals: animalCount.value,
            adoptions: adoptionCount.value,
            adopters: adopterCount.value,
            animalsEnabled
        });
    } catch (e) {
        logger.error('Quick counts API error', e);
        return NextResponse.json({ animals: 0, adoptions: 0, adopters: 0 }, { status: 500 });
    }
}
