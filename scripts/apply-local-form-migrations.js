const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dbPath = path.resolve(process.cwd(), 'local.db');
const db = new Database(dbPath);

function applySqlFile(filename) {
  const fullPath = path.resolve(process.cwd(), 'drizzle', filename);
  const sql = fs.readFileSync(fullPath, 'utf8');
  console.log(`Applying ${filename} to ${dbPath}...`);
  db.exec(sql);
}

try {
  applySqlFile('0022_add_form_submissions.sql');
  applySqlFile('0023_add_answers_json.sql');
  console.log('✅ Local form_submissions migrations applied successfully.');
} catch (e) {
  console.error('❌ Error applying local form_submissions migrations:', e);
} finally {
  db.close();
}

