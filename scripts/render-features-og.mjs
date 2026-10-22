#!/usr/bin/env node
/**
 * Link-preview image (1200x630) for /funcionalidades — the page the homepage's
 * WhatsApp referral banner shares, so this card is the first thing an invited
 * colleague sees. Composes the headline with the `search` screenshot from
 * scripts/capture-feature-screenshots.mjs; re-run both when either changes.
 *
 *   export PATH=/opt/homebrew/opt/node@20/bin:$PATH
 *   node scripts/render-features-og.mjs
 *
 * Output: public/images/features/og-invite.png
 */

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const shot = fs.readFileSync(path.join(root, 'public/images/features/shots/search.png')).toString('base64');
const out = path.join(root, 'public/images/features/og-invite.png');

const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;800&display=block" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; }
  body { width: 1200px; height: 630px; overflow: hidden; font-family: Inter, system-ui, sans-serif;
         background: #f5f5f4; display: grid; grid-template-columns: 1fr 400px; grid-template-rows: 630px; }
  .copy { padding: 72px 56px 72px 80px; display: flex; flex-direction: column; justify-content: space-between; }
  .brand { display: flex; align-items: center; gap: 16px; font-weight: 800; font-size: 30px; color: #115e59; }
  h1 { font-weight: 800; font-size: 68px; line-height: 1.08; letter-spacing: -0.02em; color: #1c1917; }
  p { font-weight: 500; font-size: 24px; line-height: 1.35; color: #57534e; }
  .phone { margin-top: 56px; width: 330px; height: 640px; border-radius: 48px; background: #fff;
           border: 1px solid #e7e5e4; padding: 10px; box-shadow: 0 30px 60px -20px rgba(0,0,0,.25); }
  .screen { width: 100%; height: 100%; border-radius: 38px; overflow: hidden;
            background: url(data:image/png;base64,${shot}) top / 100% auto no-repeat; }
</style></head><body>
  <div class="copy">
    <div class="brand">
      <svg viewBox="0 0 512 512" width="52" height="52"><path d="M256 38 C256 38 432 100 432 100 C432 100 432 270 432 270 C432 362 354 432 256 478 C158 432 80 362 80 270 C80 270 80 100 80 100 C80 100 256 38 256 38 Z" fill="#14b8a6"/><ellipse cx="256" cy="310" rx="52" ry="46" fill="#fff"/><ellipse cx="198" cy="238" rx="28" ry="34" fill="#fff" transform="rotate(-12 198 238)"/><ellipse cx="314" cy="238" rx="28" ry="34" fill="#fff" transform="rotate(12 314 238)"/><ellipse cx="158" cy="278" rx="22" ry="28" fill="#fff" transform="rotate(-28 158 278)"/><ellipse cx="354" cy="278" rx="22" ry="28" fill="#fff" transform="rotate(28 354 278)"/></svg>
      BuenAdoptante
    </div>
    <h1>La herramienta que tu refugio necesita</h1>
    <p>Verificá adoptantes, recibí formularios, enviá contratos y hacé los seguimientos. Gratis.</p>
  </div>
  <div><div class="phone"><div class="screen"></div></div></div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: out });
await browser.close();
console.log(`wrote ${path.relative(root, out)}`);
