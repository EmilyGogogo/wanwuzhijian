// Recomputes `startupBytes` in public/models/manifest.json: the total size of every model file
// AssetLibrary.prepare() downloads before the game starts (each file counted once). The loading
// bar measures against it, so run this after replacing or re-compressing any model:
//   node tools/startup-bytes.mjs          check, exit 1 if stale
//   node tools/startup-bytes.mjs --write  update the manifest
import fs from 'fs';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const manifestPath = path.join(root, 'public/models/manifest.json');
const text = fs.readFileSync(manifestPath, 'utf8'), manifest = JSON.parse(text), urls = new Set();
for (const entry of [...Object.values(manifest.species), ...manifest.decor])
  for (const key of ['url', 'idleUrl', 'runUrl', 'swimUrl']) if (entry[key]) urls.add(entry[key]);
// The scenery forest (loadVegetation): every model the vegetation list does not leave to a body.
const vegetationUrl = manifest.decor.map(s => s.scatter?.vegetation).find(Boolean);
if (vegetationUrl) {
  const base = vegetationUrl.slice(0, vegetationUrl.lastIndexOf('/') + 1);
  const vegetation = JSON.parse(fs.readFileSync(path.join(root, vegetationUrl), 'utf8'));
  for (const m of Object.values(vegetation.models || {})) if (m.scenery !== false) urls.add(base + m.model);
}
let total = 0;
for (const url of urls) total += fs.statSync(path.join(root, url)).size;
if (total === manifest.startupBytes) console.log(`startupBytes is up to date: ${total} (${urls.size} files)`);
else if (process.argv.includes('--write')) {
  fs.writeFileSync(manifestPath, text.replace(/"startupBytes":\s*\d+/, `"startupBytes": ${total}`));
  console.log(`startupBytes: ${manifest.startupBytes} -> ${total} (${urls.size} files)`);
} else {
  console.error(`startupBytes is ${manifest.startupBytes}, files total ${total}; run with --write`);
  process.exit(1);
}
