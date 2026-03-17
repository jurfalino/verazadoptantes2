-- Add dismissed column to notifications table
ALTER TABLE notifications ADD COLUMN dismissed INTEGER DEFAULT 0;
