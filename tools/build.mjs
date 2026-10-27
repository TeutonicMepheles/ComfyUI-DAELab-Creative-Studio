import fs from 'node:fs';
import {relocateMarkdownLinks} from './document_links.mjs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'frontend/src');
const output = path.join(root, 'web');
// Only files listed by our previous build may be removed; never recurse-delete a target.
const manifestPath = path.join(output, 'build-manifest.json');
if (fs.existsSync(manifestPath)) {
  const previous = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  for (const item of previous.files) {
    const target = path.resolve(output, item.path);
    if (!target.startsWith(output + path.sep)) throw new Error('Build manifest path escapes web');
    if (fs.existsSync(target) && fs.statSync(target).isFile()) fs.unlinkSync(target);
  }
}
fs.mkdirSync(output, { recursive: true });
const files = [];
const sourceHashes = [];
function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(full);
    else {
      const relative = path.relative(source, full).replaceAll('\\', '/');
      sourceHashes.push([relative, crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')]);
      if (relative.endsWith('.ts')) {
        if (!relative.endsWith('.d.ts')) files.push(relative.replace(/\.ts$/, '.js'));
      } else {
        const target = path.join(output, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        if(relative.endsWith('.md'))fs.writeFileSync(target,relocateMarkdownLinks(fs.readFileSync(full,'utf8'),full,target));
        else fs.copyFileSync(full, target);
        files.push(relative);
      }
    }
  }
}
visit(source);
const compiler = spawnSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc')], { cwd: root, stdio: 'inherit' });
if (compiler.status !== 0) process.exit(compiler.status || 1);
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const sourceFingerprint = crypto.createHash('sha256').update(JSON.stringify({version:pkg.version,files:sourceHashes.sort((a,b)=>a[0].localeCompare(b[0],'en'))})).digest('hex');
const identityPath = path.join(output, 'integrations/comfyui/index.js');
const identityCode = fs.readFileSync(identityPath, 'utf8');
if (!identityCode.includes('__CREATIVE_STUDIO_BUILD_ID__')) throw new Error('Compiled frontend build identity is missing');
fs.writeFileSync(identityPath, identityCode.replace('__CREATIVE_STUDIO_BUILD_ID__', sourceFingerprint));
const entries = files.sort().map(p => ({ path: p, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(output, p))).digest('hex') }));
fs.writeFileSync(manifestPath, JSON.stringify({ version: pkg.version, sourceFingerprint, files: entries }, null, 2) + '\n');
console.log(`Built ${entries.length} product files; test fixtures are outside frontend/src.`);
