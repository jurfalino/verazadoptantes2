-- Migration: Add notifications table for in-app notification system
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'contract_result',
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  url TEXT,
  icon TEXT DEFAULT '📋',
  read INTEGER DEFAULT 0,
  metadata TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  expires_at INTEGER
);
CREATE INDEX idx_notif_user ON notifications(user_id, read, created_at);
