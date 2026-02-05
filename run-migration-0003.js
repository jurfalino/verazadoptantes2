const Database = require('better-sqlite3');
const db = new Database('local.db');

console.log('Running migration 0003...\n');

// Create adopter_stats table
db.exec(`
    CREATE TABLE IF NOT EXISTS adopter_stats (
        id TEXT PRIMARY KEY NOT NULL,
        adopter_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
    )
`);
console.log('✓ Created adopter_stats table');

db.exec(`CREATE INDEX IF NOT EXISTS idx_stats_adopter ON adopter_stats(adopter_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_stats_created ON adopter_stats(created_at)`);
console.log('✓ Created adopter_stats indexes');

// Create app_config table
db.exec(`
    CREATE TABLE IF NOT EXISTS app_config (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        updated_at INTEGER,
        updated_by TEXT
    )
`);
console.log('✓ Created app_config table');

// Create adoption_images table
db.exec(`
    CREATE TABLE IF NOT EXISTS adoption_images (
        id TEXT PRIMARY KEY NOT NULL,
        adoption_id TEXT NOT NULL,
        url TEXT NOT NULL,
        caption TEXT,
        uploaded_at INTEGER,
        added_by TEXT
    )
`);
console.log('✓ Created adoption_images table');

db.exec(`CREATE INDEX IF NOT EXISTS idx_adoption_images ON adoption_images(adoption_id)`);
console.log('✓ Created adoption_images index');

// Add record_type column to adoptions
try {
    db.exec(`ALTER TABLE adoptions ADD COLUMN record_type TEXT DEFAULT 'adoption'`);
    console.log('✓ Added record_type column to adoptions');
} catch (e) {
    if (e.message.includes('duplicate column')) {
        console.log('✓ record_type column already exists');
    } else {
        throw e;
    }
}

// Insert default config values
db.exec(`INSERT OR IGNORE INTO app_config (key, value) VALUES ('too_many_adoptions_threshold', '5')`);
db.exec(`INSERT OR IGNORE INTO app_config (key, value) VALUES ('too_many_adoptions_period_days', '90')`);
console.log('✓ Inserted default config values');

// Verify
console.log('\nTables in database:');
const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all();
console.log(tables.map(t => t.name).join(', '));

db.close();
console.log('\n✅ Migration complete!');
