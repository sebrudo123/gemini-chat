import fs from 'fs';
import path from 'path';

// Genera dist/ con los archivos estáticos del frontend.
// Vercel publica dist/ y despliega por separado las funciones de api/.

const dist = path.resolve('dist');
if (fs.existsSync(dist)) {
  fs.rmSync(dist, { recursive: true, force: true });
}
fs.mkdirSync(dist, { recursive: true });

const files = ['index.html', 'script.js', 'favicon.svg', 'manifest.webmanifest', 'sw.js'];
for (const f of files) {
  if (fs.existsSync(f)) {
    fs.copyFileSync(f, path.join(dist, f));
  }
}
for (const dir of ['public', 'assets']) {
  if (fs.existsSync(dir)) {
    fs.cpSync(dir, dist, { recursive: true });
  }
}

console.log('Build completed: dist/ ready.');
