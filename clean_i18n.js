const fs = require('fs');
const file = 'src/components/AdoptionFormWizard.tsx';
let content = fs.readFileSync(file, 'utf8');

// Replace t('...') || '...' with t('...')
content = content.replace(/t\((['"].+?['"])(?:\s+as\s+any)?\)\s*\|\|\s*['"][^'"]+['"]/g, 't($1)');

// Also replace t(type.labelKey as any) || type.fallback
content = content.replace(/t\(type\.labelKey as any\)\s*\|\|\s*type\.fallback/g, 't(type.labelKey as any)');

// Add missing keys
content = content.replace(/uploading \? 'Uploading...' : \(t\('common\.add_media'\)\)/g, "uploading ? t('adopter.uploading') : t('common.add_media')");
content = content.replace(/loading \? 'Guardando...' : \(/g, "loading ? t('adoption.saving') : (");

fs.writeFileSync(file, content);
console.log('Done');
