-- Merge address_info into contact_info for all adopters that have address data
-- Then clear address_info (column stays but unused - SQLite doesn't support DROP COLUMN)

UPDATE adopters
SET contact_info = CASE
    WHEN contact_info IS NOT NULL AND contact_info != '' AND address_info IS NOT NULL AND address_info != ''
        THEN contact_info || char(10) || 'Address: ' || address_info
    WHEN (contact_info IS NULL OR contact_info = '') AND address_info IS NOT NULL AND address_info != ''
        THEN 'Address: ' || address_info
    ELSE contact_info
END,
address_info = NULL
WHERE address_info IS NOT NULL AND address_info != '';
