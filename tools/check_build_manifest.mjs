// Verify that the committed web/ products match web/build-manifest.json and that the
// manifest fingerprint describes frontend/src. This catches a stale or line-ending-poisoned
// manifest that `git status` cannot see, because .gitattributes normalises text on commit.
//
// Product files are hashed with their raw bytes: the manifest records the bytes the build
// wrote, so rewriting a product (for example to CRLF) must be reported even though Git
// would normalise it back on the next commit.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadTextRules, productBytes } from './text_bytes.mjs';

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

export function verifyBuildManifest(root) {
  const source = path.join(root, 'frontend/src');
  const output = path.join(root, 'web');
  const manifestPath = path.join(output, 'build-manifest.json');
  const identityPath = path.join(output, 'integrations/comfyui/index.js');
  const failures = [];

  if (!fs.existsSync(manifestPath)) {
    return { failures: ['web/build-manifest.json is missing; run npm run build.'] };
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  // 1. Every manifest entry must describe the raw bytes committed under web/.
  for (const entry of manifest.files) {
    const target = path.resolve(output, entry.path);
    if (!target.startsWith(output + path.sep)) {
      failures.push(`${entry.path}: manifest path escapes web/`);
      continue;
    }
    if (!fs.existsSync(target)) {
      failures.push(`${entry.path}: listed in the manifest but missing from web/`);
      continue;
    }
    const actual = sha256(fs.readFileSync(target));
    if (actual !== entry.sha256) {
      failures.push(`${entry.path}: manifest sha256 ${entry.sha256} does not match the file (${actual})`);
    }
  }

  // 2. The manifest must list every product file that exists, so a deleted entry cannot hide.
  const listed = new Set(manifest.files.map(entry => entry.path));
  function visit(directory) {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, item.name);
      if (item.isDirectory()) {
        visit(full);
        continue;
      }
      const relative = path.relative(output, full).replaceAll('\\', '/');
      if (relative === 'build-manifest.json') continue;
      if (!listed.has(relative)) failures.push(`${relative}: present in web/ but absent from the manifest`);
    }
  }
  visit(output);

  // 3. sourceFingerprint must describe the current frontend/src tree, using the same
  //    line-ending rules as the build so a CRLF working copy yields the same fingerprint.
  const rules = loadTextRules(root);
  const sourceHashes = [];
  function collect(directory) {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, item.name);
      if (item.isDirectory()) {
        collect(full);
        continue;
      }
      const relative = path.relative(source, full).replaceAll('\\', '/');
      sourceHashes.push([relative, sha256(productBytes(`frontend/src/${relative}`, fs.readFileSync(full), rules))]);
    }
  }
  collect(source);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const expected = sha256(Buffer.from(JSON.stringify({
    version: pkg.version,
    files: sourceHashes.sort((a, b) => a[0].localeCompare(b[0], 'en')),
  }), 'utf8'));
  if (manifest.sourceFingerprint !== expected) {
    failures.push(`sourceFingerprint ${manifest.sourceFingerprint} does not describe frontend/src (${expected})`);
  }

  // 4. The served build identity must carry the same fingerprint.
  if (!fs.existsSync(identityPath)) {
    failures.push('web/integrations/comfyui/index.js is missing');
  } else {
    const identity = fs.readFileSync(identityPath, 'utf8');
    const match = identity.match(/FRONTEND_BUILD_ID = '([0-9a-f]{64})'/);
    if (!match) failures.push('web/integrations/comfyui/index.js has no resolved FRONTEND_BUILD_ID');
    else if (match[1] !== manifest.sourceFingerprint) {
      failures.push(`FRONTEND_BUILD_ID ${match[1]} does not match sourceFingerprint ${manifest.sourceFingerprint}`);
    }
  }

  return { failures, productFiles: manifest.files.length, fingerprint: manifest.sourceFingerprint };
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { failures, productFiles, fingerprint } = verifyBuildManifest(root);
  if (failures.length) {
    console.error(`check_build_manifest: ${failures.length} problem(s)`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log(`check_build_manifest: ${productFiles} product files match the manifest; fingerprint ${fingerprint.slice(0, 12)} matches frontend/src.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
