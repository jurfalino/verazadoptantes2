/**
 * «These two profiles share an ordinary household», as a correlated SQL
 * condition — for queries that must never treat housemates as duplicates (the
 * profile banner, the «posible duplicado» badge, «Pendientes de revisar»).
 * Two indexed lookups per row (household_memberships by adopter_id, then by
 * household_id): no table scan, no bound array (D1). Gift households don't
 * count, exactly as `sameHousehold` in src/lib/households.ts (the giver and the
 * recipient may be one person). Kept apart from that module so light readers
 * (enrichAdopters) don't pull in the household read/write core.
 */
import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { PERSONAL_ID_MATCH_TYPES } from '@/domain/households';

export function sharesHomeSql(a: SQLWrapper, b: SQLWrapper): SQL {
    return sql`EXISTS (SELECT 1 FROM household_memberships hm_a
        JOIN household_memberships hm_b ON hm_b.household_id = hm_a.household_id AND hm_b.adopter_id = ${b}
        WHERE hm_a.adopter_id = ${a}
          AND NOT EXISTS (SELECT 1 FROM household_memberships hm_g WHERE hm_g.household_id = hm_a.household_id AND hm_g.gift_recipient = 1))`;
}

/**
 * The pair's stored match types (duplicate_candidates.match_types, a JSON
 * array) include a personal identifier — email or ID number. One literal LIKE
 * per type, OR'ed: no bound array (D1).
 */
export function sharesPersonalIdSql(matchTypes: SQLWrapper): SQL {
    const likes = PERSONAL_ID_MATCH_TYPES.map(t => sql`coalesce(${matchTypes}, '') LIKE ${`%"${t}"%`}`);
    return sql`(${sql.join(likes, sql` OR `)})`;
}

/**
 * THE housemate exclusion for a detected duplicate pair (final fix S3): hidden
 * only when the two share an ordinary household AND share no personal
 * identifier. Used by the profile banner, the «posible duplicado» badge (and so
 * the API's possible_duplicate) and «Pendientes de revisar»; the scan applies
 * the same rule in code (sharesPersonalIdentifier).
 */
export function hiddenAsHousematesSql(a: SQLWrapper, b: SQLWrapper, matchTypes: SQLWrapper): SQL {
    return sql`(${sharesHomeSql(a, b)} AND NOT ${sharesPersonalIdSql(matchTypes)})`;
}
