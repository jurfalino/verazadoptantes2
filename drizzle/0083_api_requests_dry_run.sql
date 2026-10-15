-- Admin read-only test calls (X-Dry-Run): logged like any call, but nothing was saved.
ALTER TABLE `api_requests` ADD `dry_run` integer DEFAULT 0 NOT NULL;
