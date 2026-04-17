# Known Duplicate Migration Prefixes

The following migration files share a numeric prefix because they were
generated on separate branches and merged independently. They are
functionally independent (no table/column conflicts) and have been
applied successfully to both staging and production.

DO NOT renumber these files — the `d1_migrations` table in all environments
references them by their current filenames.

| Prefix | Files | Status |
|--------|-------|--------|
| 0003 | `0003_adopter_enhancements.sql`, `0003_greedy_frog_thor.sql` | 🆗 Applied |
| 0004 | `0004_add_adoption_id_to_images.sql`, `0004_cute_sunfire.sql` | 🆗 Applied |
| 0006 | `0006_identity_verified.sql`, `0006_lame_lady_ursula.sql` | 🆗 Applied |
| 0007 | `0007_add_notes_column.sql`, `0007_clear_vector.sql` | 🆗 Applied |

Going forward, always verify `npx drizzle-kit generate` produces a
unique prefix before committing a new migration.
