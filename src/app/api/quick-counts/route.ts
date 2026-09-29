import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getDb } from '@/app/actions';
import { adoptions, adopters, animals } from '@/db/schema';
import { eq, and, isNull, or, count } from 'drizzle-orm';
import { getFeatureFlag } from '@/config/features';
import { getOrgMemberEmails } from '@/app/actions/organizations';
import { logger } from '@/lib/logger';
import { RECORD_TYPES } from '@/domain/constants';

export const runtime = 'edge';

export async function GET() {
    const session = await auth();
    if (!session?.user?.email) {
        return NextResponse.json({ animals: 0, adoptions: 0, adopters: 0, adoptionsEnabled: false }, { status: 401 });
    }

    try {
        const db = await getDb();
        if (!db) {
            return NextResponse.json({ animals: 0, adoptions: 0, adopters: 0, adoptionsEnabled: false }, { status: 500 });
        }

        // Never empty — getOrgMemberEmailsFor falls back to [callerEmail] on
        // every path — so the `or(...)` below can't collapse to `undefined` and
        // silently drop the filter.
        //
        // `or(...map(eq))`, never `inArray`: D1 renders `IN (?)` with a single
        // bound value no matter how long the array is, so all three counts here
        // were wrong for anyone on a team of more than one. Local sqlite expands
        // it properly, which is exactly why the tests never caught it.
        const memberEmails = await getOrgMemberEmails();
        
        // 1. My Adopters (all adopters created by org members)
        const [adopterCount] = await db.select({ value: count() })
            .from(adopters)
            .where(or(...memberEmails.map(e => eq(adopters.addedBy, e))));

        // 2. My Adoptions — strictly recordType='adoption'.
        // The chip is labeled "Mis Adopciones" — it should count true adoptions only,
        // not requests/observations/follow-ups/returns. Those types remain visible
        // via the tabs on /my-adoptions; the chip + page default just narrow to
        // adoptions to match the label. Fixed in v2.12.1-41.
        const [adoptionCount] = await db.select({ value: count() })
            .from(adoptions)
            .where(and(
                or(...memberEmails.map(e => eq(adoptions.addedBy, e))),
                eq(adoptions.recordType, RECORD_TYPES.ADOPTION)
            ));

        // 3. My Animals (Pending)
        let animalCount = { value: 0 };
        const animalsEnabled = await getFeatureFlag('ENABLE_ANIMALS_FOR_ADOPTION');
        // Same channel the menus already use for the animals entry, so the
        // adoptions entry needs no second round trip.
        const adoptionsEnabled = await getFeatureFlag('ENABLE_MY_ADOPTIONS').catch(() => false);
        
        if (animalsEnabled) {
            // Every ACTIVE animal the TEAM has, fostered and adopted included.
            // Two bugs lived here: it counted only `available`, so an animal
            // left the tally the moment it was placed; and it was scoped to one
            // person while /my-animals lists the whole org. Either way the chip
            // disagreed with the page it links to — 0 against 12, then 12
            // against 28.
            //
            // Counted off `animals`, NOT the `adoptions` view: the view UNIONs
            // adopter_events, and without the old `recordType='available'`
            // filter those event rows would be counted as animals.
            const [ac] = await db.select({ value: count() })
                .from(animals)
                .where(and(
                    or(...memberEmails.map(e => eq(animals.addedBy, e))),
                    isNull(animals.deletedAt)
                ));
            animalCount = ac;
        }

        return NextResponse.json({
            animals: animalCount.value,
            adoptions: adoptionCount.value,
            adopters: adopterCount.value,
            animalsEnabled,
            adoptionsEnabled
        });
    } catch (e) {
        logger.error('Quick counts API error', e);
        return NextResponse.json({ animals: 0, adoptions: 0, adopters: 0, adoptionsEnabled: false }, { status: 500 });
    }
}
