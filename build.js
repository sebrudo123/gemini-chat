import fs from 'fs';
import path from 'path';

// 1. Generate dist/
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
if (fs.existsSync('public')) {
  fs.cpSync('public', dist, { recursive: true });
}

// 2. Generate .vercel/output/static and config.json
const vercelOutput = path.resolve('.vercel/output');
const vercelStatic = path.join(vercelOutput, 'static');
fs.mkdirSync(vercelStatic, { recursive: true });

for (const f of files) {
  if (fs.existsSync(f)) {
    fs.copyFileSync(f, path.join(vercelStatic, f));
  }
}

const config = {
  version: 3,
  routes: [
    { src: '/api/chat', dest: '/api/chat' },
    { handle: 'filesystem' },
    { src: '/(.*)', dest: '/index.html' }
  ]
};
fs.writeFileSync(path.join(vercelOutput, 'config.json'), JSON.stringify(config, null, 2));

console.log('Build completed: dist/ and .vercel/output ready with all assets.');
