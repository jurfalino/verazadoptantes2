/**
 * Backfill script: Tokenize all adopters in the local D1 database
 * 
 * Usage: npx tsx scripts/backfill-tokens.ts
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// Find the local D1 database
const d1Dir = path.join(process.cwd(), '.wrangler', 'state', 'v3', 'd1');
let dbPath = '';

if (fs.existsSync(d1Dir)) {
    const walk = (dir: string): string | null => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                const found = walk(full);
                if (found) return found;
            } else if (entry.name.endsWith('.sqlite')) {
                return full;
            }
        }
        return null;
    };
    dbPath = walk(d1Dir) || '';
}

if (!dbPath) {
    console.error('Could not find local D1 database. Make sure you have run npm run dev at least once.');
    process.exit(1);
}

console.log(`Using database: ${dbPath}`);

const db = new Database(dbPath);

// --- Inline tokenizer (same logic as src/lib/tokenizer.ts) ---

const ACCENT_MAP: Record<string, string> = {
    'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u',
    'ü': 'u', 'ñ': 'n', 'à': 'a', 'è': 'e', 'ì': 'i',
    'ò': 'o', 'ù': 'u', 'â': 'a', 'ê': 'e', 'î': 'i',
    'ô': 'o', 'û': 'u', 'ã': 'a', 'õ': 'o',
};

function normalizeText(s: string): string {
    return s.toLowerCase().trim().replace(/[áéíóúüñàèìòùâêîôûãõ]/g, ch => ACCENT_MAP[ch] || ch);
}

function extractPhones(text: string): string[] {
    if (!text) return [];
    const cleaned = text.replace(/[\s\-\.\(\)\+]/g, '');
    const matches = cleaned.match(/\d{7,}/g) || [];
    return [...new Set(matches)];
}

function extractEmails(text: string): string[] {
    if (!text) return [];
    const matches = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) || [];
    return [...new Set(matches.map(e => e.toLowerCase()))];
}

const SOCIAL_PATTERNS = [
    /(?:https?:\/\/)?(?:www\.)?facebook\.com\/(?:profile\.php\?id=\d+|[a-zA-Z0-9.]+)/gi,
    /(?:https?:\/\/)?(?:www\.)?fb\.com\/[a-zA-Z0-9.]+/gi,
    /@[a-zA-Z0-9._]{3,30}/g,
    /(?:https?:\/\/)?(?:www\.)?instagram\.com\/[a-zA-Z0-9._]+/gi,
];

function extractSocials(text: string): string[] {
    if (!text) return [];
    const results: string[] = [];
    for (const pattern of SOCIAL_PATTERNS) {
        const matches = text.match(pattern) || [];
        results.push(...matches.map(m => m.toLowerCase().replace(/^https?:\/\/(www\.)?/, '')));
    }
    return [...new Set(results)];
}

function extractNameWords(text: string): string[] {
    if (!text) return [];
    const normalized = normalizeText(text);
    return normalized.split(/[\s,;\/|]+/).map(w => w.replace(/[^a-z]/g, '')).filter(w => w.length >= 3);
}

interface Token { type: string; value: string; }

function extractTokens(adopter: any): Token[] {
    const tokens: Token[] = [];
    const seen = new Set<string>();
    function add(type: string, value: string) {
        const key = `${type}:${value}`;
        if (!seen.has(key)) { seen.add(key); tokens.push({ type, value }); }
    }

    if (adopter.name) {
        const fullName = normalizeText(adopter.name);
        if (fullName.length >= 3) add('name_full', fullName);
        for (const word of extractNameWords(adopter.name)) add('name_word', word);
    }
    for (const phone of extractPhones(adopter.contact_info || '')) {
        add('phone', phone);
        if (phone.length >= 9) add('phone_suffix', phone.slice(-8));
    }
    for (const email of extractEmails(adopter.contact_info || '')) add('email', email);
    for (const social of extractSocials(adopter.contact_info || '')) add('social', social);
    if (adopter.source_url) add('source_url', adopter.source_url);
    return tokens;
}

function computeTokenHash(adopter: any): string {
    const parts = [adopter.name || '', adopter.contact_info || '', adopter.address_info || '', adopter.family_members || '', adopter.source_url || ''].join('|');
    let hash = 5381;
    for (let i = 0; i < parts.length; i++) {
        hash = ((hash << 5) + hash + parts.charCodeAt(i)) & 0xffffffff;
    }
    return hash.toString(36);
}

// --- Main ---

const adopters = db.prepare(`SELECT id, name, contact_info, address_info, family_members, source_url, token_hash FROM adopters WHERE deleted_at IS NULL`).all() as any[];

console.log(`Found ${adopters.length} adopters to process`);

const deleteStmt = db.prepare(`DELETE FROM duplicate_tokens WHERE adopter_id = ?`);
const insertStmt = db.prepare(`INSERT INTO duplicate_tokens (id, adopter_id, token_type, token_value) VALUES (?, ?, ?, ?)`);
const updateHashStmt = db.prepare(`UPDATE adopters SET token_hash = ? WHERE id = ?`);

let processed = 0;
let totalTokens = 0;

for (const adopter of adopters) {
    const newHash = computeTokenHash(adopter);
    if (adopter.token_hash === newHash) {
        console.log(`  ✓ ${adopter.name} — already fresh`);
        continue;
    }

    const tokens = extractTokens(adopter);

    deleteStmt.run(adopter.id);
    for (const token of tokens) {
        const id = crypto.randomUUID();
        insertStmt.run(id, adopter.id, token.type, token.value);
    }
    updateHashStmt.run(newHash, adopter.id);

    console.log(`  ✓ ${adopter.name} — ${tokens.length} tokens`);
    processed++;
    totalTokens += tokens.length;
}

// Verify
const count = (db.prepare(`SELECT COUNT(*) as c FROM duplicate_tokens`).get() as any).c;
console.log(`\nDone! Processed ${processed} adopters, created ${totalTokens} new tokens.`);
console.log(`Total tokens in database: ${count}`);

db.close();
