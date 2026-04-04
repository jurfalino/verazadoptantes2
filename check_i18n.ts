import fs from 'fs';
import path from 'path';
import { es } from './src/i18n/locales/es';
import { en } from './src/i18n/locales/en';

function getFiles(dir: string, fileList: string[] = []): string[] {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const filePath = path.join(dir, file);
        if (fs.statSync(filePath).isDirectory()) {
            getFiles(filePath, fileList);
        } else if (filePath.endsWith('.tsx') || filePath.endsWith('.ts')) {
            fileList.push(filePath);
        }
    }
    return fileList;
}

const files = getFiles('./src');
const tRegex = /t\(['"]([a-zA-Z0-9_\.]+)['"]/g;
const usedKeys = new Set<string>();

for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    let match;
    while ((match = tRegex.exec(content)) !== null) {
        usedKeys.add(match[1]);
    }
}

function getNestedProperty(obj: any, path: string) {
    if (!path || !obj) return undefined;
    return path.split('.').reduce((prev, curr) => prev ? prev[curr] : undefined, obj);
}

const missingEs = [];
const missingEn = [];

for (const key of usedKeys) {
    if (!key.includes('.')) continue; // Not a standard i18n key

    const valEs = getNestedProperty(es, key);
    if (valEs === undefined) {
        missingEs.push(key);
    }

    const valEn = getNestedProperty(en, key);
    if (valEn === undefined) {
        missingEn.push(key);
    }
}

fs.writeFileSync('missing_es_final.txt', missingEs.join('\n'), 'utf8');
fs.writeFileSync('missing_en_final.txt', missingEn.join('\n'), 'utf8');

console.log("Found", missingEs.length, "missing in ES.");
console.log("Found", missingEn.length, "missing in EN.");
