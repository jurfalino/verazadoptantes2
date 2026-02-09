-- User profiles: companion to NextAuth 'user' table
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id TEXT PRIMARY KEY,
  organization TEXT,
  role TEXT DEFAULT 'viewer',
  notes TEXT,
  comms_opt_in INTEGER DEFAULT 0,
  last_active_at INTEGER,
  created_at INTEGER DEFAULT (strftime('%s','now'))
);

-- System-wide audit log
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  user_email TEXT,
  action TEXT NOT NULL,
  target TEXT,
  details TEXT,
  device TEXT,
  is_pwa INTEGER DEFAULT 0,
  ip_address TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
