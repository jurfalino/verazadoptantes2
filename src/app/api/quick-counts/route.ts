import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getDb } from '@/app/actions';
import { adoptions, adopters, animals } from '@/db/schema';
import { eq, and, isNull, inArray, count } from 'drizzle-orm';
import { getFeatureFlag } from '@/config/features';
import { getOrgMemberEmails } from '@/app/actions/organizations';
import { logger } from '@/lib/logger';
import { RECORD_TYPES } from '@/domain/constants';

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

        // 2. My Adoptions — strictly recordType='adoption'.
        // The chip is labeled "Mis Adopciones" — it should count true adoptions only,
        // not requests/observations/follow-ups/returns. Those types remain visible
        // via the tabs on /my-adoptions; the chip + page default just narrow to
        // adoptions to match the label. Fixed in v2.12.1-41.
        const [adoptionCount] = await db.select({ value: count() })
            .from(adoptions)
            .where(and(
                inArray(adoptions.addedBy, memberEmails),
                eq(adoptions.recordType, RECORD_TYPES.ADOPTION)
            ));

        // 3. My Animals (Pending)
        let animalCount = { value: 0 };
        const animalsEnabled = await getFeatureFlag('ENABLE_ANIMALS_FOR_ADOPTION');
        
        if (animalsEnabled) {
            // Every ACTIVE animal this person created — fostered and adopted
            // ones included. It counted only `available` before, so an animal
            // silently left the tally the moment it was placed, which made the
            // chip disagree with the page it links to.
            //
            // Counted off `animals`, NOT the `adoptions` view: the view UNIONs
            // adopter_events, and without the old `recordType='available'`
            // filter those event rows would be counted as animals.
            const [ac] = await db.select({ value: count() })
                .from(animals)
                .where(and(
                    eq(animals.addedBy, session.user.email),
                    isNull(animals.deletedAt)
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
