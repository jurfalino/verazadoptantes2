const Database = require('better-sqlite3');
const db = new Database('local.db');

try {
    console.log('Renaming column familyMembers to family_members...');
    db.prepare('ALTER TABLE adopters RENAME COLUMN familyMembers TO family_members').run();
    console.log('Column renamed successfully.');
} catch (e) {
    console.error('Error renaming column:', e);
} finally {
    db.close();
}
