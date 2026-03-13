-- Migration: Add adoption_id column to adopter_images table
-- This links images to specific adoption records

-- Deprecated: `adoption_id` is now created in 0003_greedy_frog_thor.sql.
-- Keep this as a harmless no-op to avoid duplicate-column errors.

SELECT 1;
