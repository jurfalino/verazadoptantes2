import { es } from './src/i18n/locales/es';
import { en } from './src/i18n/locales/en';

function findEmptyKeys(obj: any, prefix = ''): string[] {
    let emptyKeys: string[] = [];
    for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'string' && v.trim() === '') {
            emptyKeys.push(prefix ? `${prefix}.${k}` : k);
        } else if (typeof v === 'object' && v !== null) {
            emptyKeys = emptyKeys.concat(findEmptyKeys(v, prefix ? `${prefix}.${k}` : k));
        }
    }
    return emptyKeys;
}

const emptyEs = findEmptyKeys(es);
const emptyEn = findEmptyKeys(en);

console.log("Empty in ES:", emptyEs);
console.log("Empty in EN:", emptyEn);
