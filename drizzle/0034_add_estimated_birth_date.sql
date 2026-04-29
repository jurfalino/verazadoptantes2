-- Step 1: Add column
ALTER TABLE adoptions ADD COLUMN estimated_birth_date INTEGER;

-- Step 2: Backfill from existing age text + record date
-- Extracts the leading number, detects the unit (año/year → ×365d, mes/month → ×30d),
-- and subtracts from the record's date. Unparseable values are silently skipped.
UPDATE adoptions
SET estimated_birth_date = CASE
    WHEN age LIKE '%año%' OR age LIKE '%year%' THEN
        date - (CAST(SUBSTR(age, 1, INSTR(age, ' ') - 1) AS INTEGER) * 365 * 24 * 3600)
    WHEN age LIKE '%mes%' OR age LIKE '%month%' THEN
        date - (CAST(SUBSTR(age, 1, INSTR(age, ' ') - 1) AS INTEGER) * 30 * 24 * 3600)
    ELSE NULL
END
WHERE age IS NOT NULL
  AND estimated_birth_date IS NULL
  AND INSTR(age, ' ') > 1
  AND CAST(SUBSTR(age, 1, INSTR(age, ' ') - 1) AS INTEGER) > 0;
