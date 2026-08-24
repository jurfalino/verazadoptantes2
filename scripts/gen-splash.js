// Generates iOS apple-touch-startup-image PNGs: the shield-paw logo (white on
// brand teal) centered on a teal ground, one per common iPhone/iPad portrait
// size, into public/splash/. Also prints the <link> tags to paste into the
// head. Run: node scripts/gen-splash.js
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const TEAL = '#0f766e';
const OUT = path.join(__dirname, '..', 'public', 'splash');
fs.mkdirSync(OUT, { recursive: true });

// [cssWidth, cssHeight, dpr] — portrait only (manifest is portrait-primary).
const DEVICES = [
  [320, 568, 2], [375, 667, 2], [414, 736, 3], [375, 812, 3],
  [414, 896, 2], [414, 896, 3], [390, 844, 3], [428, 926, 3],
  [393, 852, 3], [430, 932, 3],
  [768, 1024, 2], [810, 1080, 2], [834, 1112, 2], [834, 1194, 2], [1024, 1366, 2],
];

// White shield + teal paw pads (inverted from the launcher icon so it reads on teal).
const LOGO = `
  <path d="M256 38 C256 38 432 100 432 100 C432 100 432 270 432 270 C432 362 354 432 256 478 C158 432 80 362 80 270 C80 270 80 100 80 100 C80 100 256 38 256 38 Z" fill="#ffffff"/>
  <ellipse cx="256" cy="310" rx="52" ry="46" fill="${TEAL}"/>
  <ellipse cx="198" cy="238" rx="28" ry="34" fill="${TEAL}" transform="rotate(-12 198 238)"/>
  <ellipse cx="314" cy="238" rx="28" ry="34" fill="${TEAL}" transform="rotate(12 314 238)"/>
  <ellipse cx="158" cy="278" rx="22" ry="28" fill="${TEAL}" transform="rotate(-28 158 278)"/>
  <ellipse cx="354" cy="278" rx="22" ry="28" fill="${TEAL}" transform="rotate(28 354 278)"/>`;

function svgFor(w, h) {
  const s = Math.round(Math.min(w, h) * 0.32);      // logo box
  const lx = Math.round((w - s) / 2);
  const ly = Math.round((h - s) / 2 - s * 0.34);     // nudge up to make room for the name
  const fontSize = Math.round(s * 0.20);
  const textY = ly + s + Math.round(s * 0.42);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <rect width="${w}" height="${h}" fill="${TEAL}"/>
    <g transform="translate(${lx},${ly}) scale(${s / 512})">${LOGO}</g>
    <text x="${w / 2}" y="${textY}" fill="#ffffff" text-anchor="middle" font-weight="600"
      font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"
      font-size="${fontSize}" letter-spacing="0.5">Buen Adoptante</text>
  </svg>`;
}

const links = [];
(async () => {
  for (const [cw, ch, dpr] of DEVICES) {
    const w = cw * dpr, h = ch * dpr;
    const file = `apple-splash-${w}x${h}.png`;
    await sharp(Buffer.from(svgFor(w, h))).png().toFile(path.join(OUT, file));
    links.push(
      `<link rel="apple-touch-startup-image" href="/splash/${file}" ` +
      `media="(device-width: ${cw}px) and (device-height: ${ch}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait)" />`
    );
  }
  fs.writeFileSync(path.join(OUT, '_links.html'), links.join('\n'));
  console.log(`Generated ${DEVICES.length} splash PNGs → public/splash/`);
  console.log(links.join('\n'));
})();
