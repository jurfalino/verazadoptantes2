-- 2026-11-10: Mis adoptantes «Filtros» — the filters a person pinned onto the
-- main screen (up to 4), as a JSON array of FilterKey (src/domain/adopterListView.ts).
-- NULL = the defaults («Por formulario», «Desde un post»). Per person, not per team:
-- a preference, never shared data. Read/written by src/lib/adopterListPins.ts. Additive only.
ALTER TABLE user_profiles ADD COLUMN adopter_list_pins TEXT;
