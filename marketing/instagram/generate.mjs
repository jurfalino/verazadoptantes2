// Buen Adoptante — Instagram asset generator.
// One template + all copy here → consistent on-brand SVGs (1080×1080).
// Run: node generate.mjs   (then: qlmanage -t -s 1080 -o . *.svg  to make PNGs)
import { writeFileSync } from 'node:fs';

const FONT = "'Poppins','Montserrat','Trebuchet MS',Arial,sans-serif";
const C = {
  deep: '#042f2e', teal: '#0f766e', tealBright: '#14b8a6', tealLight: '#5eead4',
  white: '#ffffff', cream: '#f2f2f7', bodyDark: '#cbd5d1', bodyLight: '#475569',
};

// shield + paw mark, visually centered at (x,y), `s`=scale (1 ≈ 110px wide)
const mark = (x, y, s, shield, paw) => `
  <g transform="translate(${x},${y}) scale(${s}) translate(-256,-258)">
    <path d="M256 38 C256 38 432 100 432 100 C432 100 432 270 432 270 C432 362 354 432 256 478 C158 432 80 362 80 270 C80 270 80 100 80 100 C80 100 256 38 256 38 Z" fill="${shield}"/>
    <ellipse cx="256" cy="310" rx="52" ry="46" fill="${paw}"/>
    <ellipse cx="198" cy="238" rx="28" ry="34" fill="${paw}" transform="rotate(-12 198 238)"/>
    <ellipse cx="314" cy="238" rx="28" ry="34" fill="${paw}" transform="rotate(12 314 238)"/>
    <ellipse cx="158" cy="278" rx="22" ry="28" fill="${paw}" transform="rotate(-28 158 278)"/>
    <ellipse cx="354" cy="278" rx="22" ry="28" fill="${paw}" transform="rotate(28 354 278)"/>
  </g>`;

const pawWatermark = (color, op) => `
  <g transform="translate(880,860) scale(2.8) translate(-256,-272)" fill="${color}" opacity="${op}">
    <ellipse cx="256" cy="310" rx="52" ry="46"/>
    <ellipse cx="198" cy="238" rx="28" ry="34" transform="rotate(-12 198 238)"/>
    <ellipse cx="314" cy="238" rx="28" ry="34" transform="rotate(12 314 238)"/>
    <ellipse cx="158" cy="278" rx="22" ry="28" transform="rotate(-28 158 278)"/>
    <ellipse cx="354" cy="278" rx="22" ry="28" transform="rotate(28 354 278)"/>
  </g>`;

const variants = {
  dark:  { bg:`<rect width="1080" height="1080" fill="url(#bg)"/>`, head:C.white, accent:C.tealLight, body:C.bodyDark, rule:C.tealBright, mShield:C.tealBright, mPaw:C.deep, wm:[C.white,0.05], handle:C.tealLight, meta:'#7c9c98', lockTeal:C.tealLight },
  light: { bg:`<rect width="1080" height="1080" fill="${C.cream}"/>`, head:C.deep, accent:C.teal, body:C.bodyLight, rule:C.teal, mShield:C.teal, mPaw:C.white, wm:[C.teal,0.06], handle:C.teal, meta:'#94a3b8', lockTeal:C.teal },
  teal:  { bg:`<rect width="1080" height="1080" fill="${C.teal}"/>`, head:C.white, accent:C.deep, body:'#d7f5f0', rule:C.deep, mShield:C.white, mPaw:C.teal, wm:[C.white,0.08], handle:C.white, meta:'#bdeee6', lockTeal:'#bdeee6' },
};

const lockup = (v) => `
  ${mark(120, 112, 0.20, v.mShield, v.mPaw)}
  <text x="180" y="124" font-family="${FONT}" font-size="34" font-weight="800" letter-spacing="1" fill="${v.head}">BUEN <tspan fill="${v.lockTeal}">ADOPTANTE</tspan></text>`;

// headline: array of {t, accent?} lines, vertically centered around cy
function headlineBlock(lines, cy, v, size = 78, lh = 94) {
  const total = (lines.length - 1) * lh;
  let y = cy - total / 2;
  return lines.map(l => {
    const t = `<text x="540" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="800" fill="${l.accent ? v.accent : v.head}" text-anchor="middle">${l.t}</text>`;
    y += lh; return t;
  }).join('\n  ');
}
function bodyBlock(lines, top, v, size = 37, lh = 52) {
  let y = top;
  return lines.map(l => {
    const t = `<text x="540" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="500" fill="${v.body}" text-anchor="middle">${l}</text>`;
    y += lh; return t;
  }).join('\n  ');
}

const defs = `<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b3d39"/><stop offset="1" stop-color="#042f2e"/></linearGradient></defs>`;

function slide({ variant='dark', head, body, ruleY=648, bodyTop=726, footerL, footerR, footerRColor }) {
  const v = variants[variant];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1080" width="1080" height="1080">
  ${defs}
  ${v.bg}
  ${pawWatermark(v.wm[0], v.wm[1])}
  ${lockup(v)}
  ${headlineBlock(head, 470, v)}
  <rect x="450" y="${ruleY}" width="180" height="8" rx="4" fill="${v.rule}"/>
  ${bodyBlock(body, bodyTop, v)}
  <text x="96" y="1000" font-family="${FONT}" font-size="30" font-weight="600" fill="${v.handle}">@buenadoptante</text>
  ${footerR ? `<text x="984" y="1000" font-family="${FONT}" font-size="30" font-weight="700" fill="${footerRColor||v.meta}" text-anchor="end">${footerR}</text>` : ''}
</svg>`;
}

// ---------- CONTENT ----------
const carousel = [
  // slide 1 (cover) is hand-authored in carousel-01-cover.svg — keep it.
  { n:2, variant:'dark', head:[{t:'Un mal adoptante'},{t:'no avisa.',accent:true}],
    body:['Maltrato, reventa, abandono, criaderos.','La misma persona va de un rescate a','otro… y nadie conecta los puntos.'] },
  { n:3, variant:'dark', head:[{t:'Es el Veraz'},{t:'de las adopciones.',accent:true}],
    body:['Un chequeo de antecedentes del adoptante:','rescatistas comparten y consultan el','historial de cada uno antes de entregar.'] },
  { n:4, variant:'light', head:[{t:'Antes de entregar,'},{t:'buscá.',accent:true}],
    body:['Por nombre, teléfono o redes.','Si alguien ya lo registró, vas a ver su','historial, calificaciones y alertas.'] },
  { n:5, variant:'dark', head:[{t:'Después de adoptar,'},{t:'registrá.',accent:true}],
    body:['Sumá lo que sabés —bueno o malo—.','Lo que cargás hoy protege','al próximo animal.'] },
  { n:6, variant:'light', head:[{t:'Hecho por rescatistas,'},{t:'para rescatistas.',accent:true}],
    body:['Gratis y colaborativo. Es info entre','rescatistas para proteger,','no una lista pública para exponer.'] },
];
for (const s of carousel) {
  writeFileSync(`carousel-0${s.n}-${['','','problema','queses','buscar','registrar','confianza'][s.n]}.svg`,
    slide({ variant:s.variant, head:s.head, body:s.body, footerR:`${s.n} / 7` }));
}
// slide 7 — CTA (solid teal, big)
writeFileSync('carousel-07-cta.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1080" width="1080" height="1080">
  ${variants.teal.bg}
  ${pawWatermark(C.white,0.08)}
  ${lockup(variants.teal)}
  ${headlineBlock([{t:'Sumate'},{t:'a la red.'}],430,variants.teal,92,108)}
  <rect x="450" y="612" width="180" height="8" rx="4" fill="${C.deep}"/>
  ${bodyBlock(['Creá tu cuenta gratis y','empezá a consultar hoy.'],690,variants.teal)}
  <rect x="300" y="800" width="480" height="92" rx="46" fill="${C.white}"/>
  <text x="540" y="861" font-family="${FONT}" font-size="40" font-weight="800" fill="${C.teal}" text-anchor="middle">buenadoptante.org</text>
  <text x="96" y="1000" font-family="${FONT}" font-size="30" font-weight="600" fill="${C.white}">@buenadoptante</text>
  <text x="984" y="1000" font-family="${FONT}" font-size="30" font-weight="700" fill="#bdeee6" text-anchor="end">7 / 7</text>
</svg>`);

// ---------- SEED POSTS (grid rhythm: dark / light / teal) ----------
const posts = [
  { f:'post-01-hook',         variant:'dark',  head:[{t:'Entregar sin verificar'},{t:'es confiar en un',accent:false},{t:'desconocido.',accent:true}], body:['Verificar no es desconfiar de todos.','Es proteger al que no puede elegir. 🐾'] },
  { f:'post-02-reincidentes', variant:'light', head:[{t:'Los reincidentes'},{t:'cuentan con que nadie'},{t:'comparta la info.',accent:true}], body:['Cuando se comparte,','dejan de pasar desapercibidos.'] },
  { f:'post-03-pasos',        variant:'teal',  head:[{t:'Buscá → Revisá'},{t:'→ Entregá tranquila.'}], body:['Tres pasos antes de cada entrega.','Gratis · link en bio'] },
  { f:'post-04-mito',         variant:'dark',  head:[{t:'“Me da cosa'},{t:'desconfiar.”'},{t:'No: es cuidar.',accent:true}], body:['Chequear no te hace mala rescatista.','Te hace responsable. 🛡️'] },
  { f:'post-05-privacidad',   variant:'light', head:[{t:'No es una lista'},{t:'pública. Es info'},{t:'entre rescatistas.',accent:true}], body:['Una herramienta para cuidarnos','entre protectoras y cuidar al animal.'] },
  { f:'post-06-cta',          variant:'teal',  head:[{t:'Tu próxima adopción'},{t:'puede ser más segura.'}], body:['Si rescatás, esta red es tuya.','Sumate 👉 link en bio'] },
];
for (const p of posts) {
  writeFileSync(`${p.f}.svg`, slide({ variant:p.variant, head:p.head, body:p.body, ruleY:692, bodyTop:770 }));
}

// ---------- PROFILE IMAGE (mark larger to fill the circle crop) ----------
writeFileSync('profile-image.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1080" width="1080" height="1080">
  <rect width="1080" height="1080" fill="${C.cream}"/>
  ${mark(540, 552, 2.0, C.teal, C.white)}
</svg>`);

// ---------- LOGO LOCKUP (horizontal, transparent bg) ----------
// Square stacked lockup (1080×1080) — renders faithfully and is IG-ready.
writeFileSync('logo-lockup.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1080" width="1080" height="1080">
  <rect width="1080" height="1080" fill="${C.white}"/>
  ${mark(540, 360, 1.15, C.teal, C.white)}
  <text x="540" y="760" font-family="${FONT}" font-size="92" font-weight="800" letter-spacing="2" fill="${C.deep}" text-anchor="middle">BUEN</text>
  <text x="540" y="858" font-family="${FONT}" font-size="92" font-weight="800" letter-spacing="2" fill="${C.teal}" text-anchor="middle">ADOPTANTE</text>
  <text x="540" y="928" font-family="${FONT}" font-size="32" font-weight="500" fill="${C.bodyLight}" text-anchor="middle">El Veraz de las adopciones · chequeo de antecedentes</text>
</svg>`);

// ---------- HIGHLIGHT COVERS (teal bg, white glyph centered for circle-crop) ----------
// IG crops covers to a centered circle, so the glyph is dead-center and there is
// no baked-in label (IG shows the highlight name underneath).
const cover = (file, glyph) => writeFileSync(file, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1080" width="1080" height="1080">
  <rect width="1080" height="1080" fill="${C.teal}"/>
  <g transform="translate(540,540)" fill="none" stroke="${C.white}" stroke-width="36" stroke-linecap="round" stroke-linejoin="round">${glyph}</g>
</svg>`);
cover('highlight-quees.svg',  `<g transform="scale(0.64) translate(-256,-258)" stroke="none" fill="${C.white}"><path d="M256 38 C256 38 432 100 432 100 C432 100 432 270 432 270 C432 362 354 432 256 478 C158 432 80 362 80 270 C80 270 80 100 80 100 C80 100 256 38 256 38 Z"/><ellipse cx="256" cy="310" rx="52" ry="46" fill="${C.teal}"/><ellipse cx="198" cy="238" rx="28" ry="34" fill="${C.teal}" transform="rotate(-12 198 238)"/><ellipse cx="314" cy="238" rx="28" ry="34" fill="${C.teal}" transform="rotate(12 314 238)"/><ellipse cx="158" cy="278" rx="22" ry="28" fill="${C.teal}" transform="rotate(-28 158 278)"/><ellipse cx="354" cy="278" rx="22" ry="28" fill="${C.teal}" transform="rotate(28 354 278)"/></g>`);
cover('highlight-como.svg',   `<circle cx="-55" cy="-55" r="135"/><line x1="48" y1="48" x2="170" y2="170"/>`);
cover('highlight-faq.svg',    `<g stroke="none" fill="${C.white}"><text x="0" y="135" font-family="${FONT}" font-size="380" font-weight="800" text-anchor="middle">?</text></g>`);
cover('highlight-sumate.svg', `<line x1="-150" y1="0" x2="150" y2="0"/><line x1="0" y1="-150" x2="0" y2="150"/>`);

console.log('Generated all Buen Adoptante assets.');
