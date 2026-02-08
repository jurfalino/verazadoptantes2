import { execSync } from 'child_process';
import path from 'path';

/**
 * Playwright global setup — seeds the local D1 database with test data.
 * Runs once before all test files.
 */
export default function globalSetup() {
    const seedFile = path.resolve(__dirname, 'seed.sql');
    console.log('[Global Setup] Seeding local D1 with test data...');

    try {
        execSync(`npx wrangler d1 execute DB --local --file="${seedFile}"`, {
            cwd: path.resolve(__dirname, '..'),
            stdio: 'inherit',
        });
        console.log('[Global Setup] Seed complete.');
    } catch (error) {
        console.error('[Global Setup] Failed to seed database:', error);
        throw error;
    }
}
