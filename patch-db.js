const Database = require('better-sqlite3');
const db = new Database('local.db');

try {
    console.log('Checking schema...');
    const columns = db.pragma('table_info(adopters)');
    const hasFamilyMembers = columns.some(c => c.name === 'familyMembers');

    if (!hasFamilyMembers) {
        console.log('Adding familyMembers column...');
        db.prepare('ALTER TABLE adopters ADD COLUMN familyMembers TEXT').run();
        console.log('Column added successfully.');
    } else {
        console.log('Column familyMembers already exists.');
    }
} catch (e) {
    console.error('Error patching DB:', e);
} finally {
    db.close();
}
