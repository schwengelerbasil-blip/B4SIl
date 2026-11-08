// Copies site/ to dist/ and writes a static audio-manifest.json (for static hosting).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAudioManifest } from './audio-manifest.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'site');
const out = path.join(root, 'dist');

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(src, out, { recursive: true });
fs.writeFileSync(path.join(out, 'audio-manifest.json'), JSON.stringify(buildAudioManifest(path.join(src, 'audio'))));
console.log('Built → dist/');
