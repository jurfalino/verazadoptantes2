const Database = require('better-sqlite3');
const db = new Database('local.db');

try {
    const columns = db.pragma('table_info(adopters)');
    console.log('Columns in adopters table:');
    columns.forEach(c => console.log(`- ${c.name} (${c.type})`));
} catch (e) {
    console.error(e);
} finally {
    db.close();
}
