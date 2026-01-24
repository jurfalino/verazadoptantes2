const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(process.cwd(), 'local.db');
console.log(`Opening database at ${dbPath}`);

const db = new Database(dbPath);

try {
    // Check adoptions table info
    const columns = db.pragma('table_info(adoptions)');
    const hasSpecies = columns.some(c => c.name === 'species');

    if (!hasSpecies) {
        console.log('Adding species column to adoptions table...');
        db.prepare('ALTER TABLE adoptions ADD COLUMN species TEXT').run();
        console.log('Done.');
    } else {
        console.log('species column already exists in adoptions.');
    }

    // Check adopters table
    const adptCols = db.pragma('table_info(adopters)');
    console.log('Adopters columns:', adptCols.map(c => c.name).join(', '));

} catch (e) {
    console.error('Error patching DB:', e);
} finally {
    db.close();
}
