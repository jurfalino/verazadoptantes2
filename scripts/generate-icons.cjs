const sharp = require('sharp');
const path = require('path');
const SRC = path.join(__dirname, '..', 'public', 'icon-512.png');
const OUT = (name) => path.join(__dirname, '..', 'public', name);
const tasks = [
  sharp(SRC).resize(192, 192).png().toFile(OUT('icon-192.png')).then(() => console.log('wrote icon-192.png')),
  sharp(SRC).resize(180, 180).png().toFile(OUT('apple-touch-icon.png')).then(() => console.log('wrote apple-touch-icon.png')),
];
Promise.all(tasks).then(() => console.log('done'));
