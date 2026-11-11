import fs from 'fs';
import path from 'path';

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

// Copy public/ if any extra assets exist
if (fs.existsSync('public')) {
  fs.cpSync('public', dist, { recursive: true });
}

console.log('Build output generated in dist/ directory with all static assets.');
