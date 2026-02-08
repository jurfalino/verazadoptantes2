-- Add source_url to adoptions to track which Facebook post each record originated from
ALTER TABLE adoptions ADD COLUMN source_url TEXT;
