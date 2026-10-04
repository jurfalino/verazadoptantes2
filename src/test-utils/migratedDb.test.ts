import { describe, it, expect } from 'vitest';
import { migratedDb } from './migratedDb';

describe('migratedDb', () => {
    it('builds the schema the actions read', () => {
        const { sqlite } = migratedDb();
        const cols = (t: string) => (sqlite.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).map(c => c.name);
        expect(cols('adopters')).toEqual(expect.arrayContaining(['id', 'added_by', 'created_at', 'deleted_at', 'is_demo', 'token_hash']));
        expect(cols('adopter_images')).toEqual(expect.arrayContaining(['adoption_id', 'scope', 'added_by']));
        expect(cols('placements')).toEqual(expect.arrayContaining(['animal_id', 'adopter_id', 'recorded_by']));
        expect(cols('adoptions')).toEqual(expect.arrayContaining(['adopter_id', 'verified_address', 'added_by']));
    });
});
