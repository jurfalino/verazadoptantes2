-- Drop unused adoption_images table (all adoption images use adopter_images.adoption_id)
DROP TABLE IF EXISTS adoption_images;
