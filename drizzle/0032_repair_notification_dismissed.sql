-- Repair: 0031 had broken newlines so the ALTER TABLE never executed.
-- D1 recorded 0031 as applied but the column was never created.
ALTER TABLE notifications ADD COLUMN dismissed INTEGER DEFAULT 0;
