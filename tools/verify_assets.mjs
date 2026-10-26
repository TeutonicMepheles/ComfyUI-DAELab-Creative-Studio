import fs from 'node:fs';
import crypto from 'node:crypto';
const root = new URL('../web/design/vendor/', import.meta.url);
const fonts = new URL('alibaba-puhuiti-3/', root);
const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', fonts), 'utf8'));
for (const item of manifest) {
  const data = fs.readFileSync(new URL(item.file, fonts));
  if (data.length !== item.bytes || crypto.createHash('sha256').update(data).digest('hex') !== item.sha256) throw Error(`Font hash mismatch: ${item.file}`);
}
for (const name of ['alibaba-puhuiti-3/LICENSE.txt', 'remixicon/LICENSE']) {
  if (!fs.readFileSync(new URL(name, root), 'utf8').trim()) throw Error(`Missing asset license: ${name}`);
}
console.log('Original font hashes and third-party license files verified in build output.');
