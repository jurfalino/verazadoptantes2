-- Add media_type column to adopter_images
-- Allows reliable detection of image vs video without extension guessing
ALTER TABLE adopter_images ADD COLUMN media_type TEXT DEFAULT 'image';
