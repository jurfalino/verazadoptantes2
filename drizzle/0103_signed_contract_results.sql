-- 2026-11-08 H1: a contract result lives with the signed contract, not only in
-- its notice. What the adopter typed (submitted_json), how many profiles it
-- matched at signing (match_count) and the placement the signing opened
-- (placement_id), so «Datos y posibles duplicados» opens without the notice
-- (src/lib/contractResult.ts). Additive only; older rows stay NULL and show the
-- PDF button alone until the backfill below fills what their notice still has.
ALTER TABLE signed_contracts ADD COLUMN submitted_json TEXT;
--> statement-breakpoint
ALTER TABLE signed_contracts ADD COLUMN match_count INTEGER;
--> statement-breakpoint
ALTER TABLE signed_contracts ADD COLUMN placement_id TEXT;
--> statement-breakpoint
-- Backfill (idempotent; touches only NULL columns). Production had 0
-- signed_contracts rows on 2026-11-08, so this only matters on staging.
-- 1) The placement whose stored contract is this signature's file.
UPDATE signed_contracts SET placement_id = (
    SELECT p.id FROM placements p
    WHERE p.animal_id = signed_contracts.animal_id AND p.contract_key = signed_contracts.file_key
    ORDER BY p.started_at DESC LIMIT 1)
WHERE placement_id IS NULL AND file_key IS NOT NULL;
--> statement-breakpoint
-- 2) Typed data + match count from the rescuer's own contract_result notice
-- (the teammate copy has no submittedData), the one closest in time to the signing.
WITH nv AS (
    SELECT n.created_at,
        CASE WHEN json_valid(n.metadata) THEN json_extract(n.metadata, '$.animalId') END AS animal_id,
        CASE WHEN json_valid(n.metadata) THEN json_extract(n.metadata, '$.adopterId') END AS adopter_id,
        CASE WHEN json_valid(n.metadata) THEN json_extract(n.metadata, '$.submittedData') END AS sd,
        CASE WHEN json_valid(n.metadata) THEN json_extract(n.metadata, '$.matchCount') END AS mc
    FROM notifications n WHERE n.type = 'contract_result'
), m AS (
    SELECT sc.id AS sc_id, nv.sd, nv.mc,
        ROW_NUMBER() OVER (PARTITION BY sc.id ORDER BY abs(nv.created_at - sc.signed_at)) AS rn
    FROM signed_contracts sc
    JOIN nv ON nv.animal_id = sc.animal_id AND nv.adopter_id = sc.adopter_id AND nv.sd IS NOT NULL
    WHERE sc.submitted_json IS NULL
)
UPDATE signed_contracts SET submitted_json = m.sd, match_count = m.mc
FROM m WHERE m.sc_id = signed_contracts.id AND m.rn = 1;
