import Database from 'better-sqlite3';

const db = new Database('local.db');

// Enable WAL for better concurrency
db.pragma('journal_mode = WAL');

// Insert some adopters
const insertAdopter = db.prepare(`
  INSERT OR IGNORE INTO adopters (id, name, phone, email, address, status, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const now = Math.floor(Date.now() / 1000);

insertAdopter.run(
    'adopter_1',
    'John Doe',
    '1234567890',
    'john@example.com',
    '123 Main St',
    'good',
    now,
    now
);

insertAdopter.run(
    'adopter_2',
    'Jane Smith',
    '9876543210',
    'jane@evil.com',
    '666 Bad Ave',
    'blocked',
    now,
    now
);

console.log('Seeded local.db');
