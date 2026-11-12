// Refreshes MediaPipe (hand detection) in vendor/ and the hand model in models/.
// Both are committed, so this is only needed to update them: npm install && npm run setup
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mp = join(root, 'node_modules/@mediapipe/tasks-vision');
const vendor = join(root, 'vendor/mediapipe');
mkdirSync(join(vendor, 'wasm'), { recursive: true });
cpSync(join(mp, 'vision_bundle.mjs'), join(vendor, 'vision_bundle.mjs'));
for (const f of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm']) cpSync(join(mp, 'wasm', f), join(vendor, 'wasm', f));

const url = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const res = await fetch(url);
if (!res.ok) throw new Error(`model download failed: ${res.status}`);
mkdirSync(join(root, 'models'), { recursive: true });
writeFileSync(join(root, 'models/hand_landmarker.task'), Buffer.from(await res.arrayBuffer()));
console.log('vendor ready');
