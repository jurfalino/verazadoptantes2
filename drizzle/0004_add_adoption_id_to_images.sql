-- Migration: Add adoption_id column to adopter_images table
-- This links images to specific adoption records

ALTER TABLE adopter_images ADD COLUMN adoption_id TEXT;
