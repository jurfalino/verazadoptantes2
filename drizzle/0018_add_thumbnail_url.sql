-- Add thumbnail_url column to adopter_images
-- Stores a URL to a thumbnail image for video records
ALTER TABLE adopter_images ADD COLUMN thumbnail_url TEXT;
