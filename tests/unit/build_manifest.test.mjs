import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {loadTextRules, productBytes} from '../../tools/text_bytes.mjs';
import {verifyBuildManifest} from '../../tools/check_build_manifest.mjs';

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function fixtureRoot(attributes) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-check-'));
  fs.writeFileSync(path.join(root, '.gitattributes'), attributes);
  fs.mkdirSync(path.join(root, 'frontend/src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'web'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture', version: '0.0.0-fixture' }));
  return root;
}

// Writes a source file plus the matching product file and manifest, mirroring tools/build.mjs.
function writeProduct(root, relativePath, bytes, { productBytesOverride } = {}) {
  const rules = loadTextRules(root);
  const sourcePath = path.join(root, 'frontend/src', relativePath);
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  fs.writeFileSync(sourcePath, bytes);
  const productPath = path.join(root, 'web', relativePath);
  fs.mkdirSync(path.dirname(productPath), { recursive: true });
  fs.writeFileSync(productPath, productBytesOverride ?? productBytes(`frontend/src/${relativePath}`, bytes, rules));
}

function writeManifest(root) {
  const rules = loadTextRules(root);
  const source = path.join(root, 'frontend/src');
  const output = path.join(root, 'web');
  const sourceHashes = [];
  (function collect(directory) {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, item.name);
      if (item.isDirectory()) { collect(full); continue; }
      const relative = path.relative(source, full).replaceAll('\\', '/');
      sourceHashes.push([relative, sha256(productBytes(`frontend/src/${relative}`, fs.readFileSync(full), rules))]);
    }
  })(source);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const sourceFingerprint = sha256(Buffer.from(JSON.stringify({
    version: pkg.version,
    files: sourceHashes.sort((a, b) => a[0].localeCompare(b[0], 'en')),
  }), 'utf8'));
  const files = [];
  // Build writes the resolved identity before the manifest, so index.js is itself a listed
  // product whose hash covers the fingerprint.
  fs.mkdirSync(path.join(output, 'integrations/comfyui'), { recursive: true });
  fs.writeFileSync(path.join(output, 'integrations/comfyui/index.js'),
    `export const FRONTEND_BUILD_ID = '${sourceFingerprint}';\n`);
  (function collect(directory) {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, item.name);
      if (item.isDirectory()) { collect(full); continue; }
      const relative = path.relative(output, full).replaceAll('\\', '/');
      if (relative === 'build-manifest.json') continue;
      files.push({ path: relative, sha256: sha256(fs.readFileSync(full)) });
    }
  })(output);
  fs.writeFileSync(path.join(output, 'build-manifest.json'), JSON.stringify({
    version: pkg.version,
    sourceFingerprint,
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
  }, null, 2));
  return sourceFingerprint;
}

const ATTRIBUTES = ['* text=auto eol=lf', '*.png -text', '*.woff2 -text', 'frontend/src/design/vendor/** -text', 'web/design/vendor/** -text', ''].join('\n');

test('slash-less attribute patterns match files at any depth, not just the repository root', () => {
  const root = fixtureRoot(ATTRIBUTES);
  const rules = loadTextRules(root);
  assert.equal(rules.isBinary('nested/deep/diagram.png'), true);
  assert.equal(rules.isBinary('diagram.png'), true);
  assert.equal(rules.isBinary('fonts/nested/deep/font.woff2'), true);
  assert.equal(rules.isBinary('frontend/src/design/vendor/model-icons/libtv.svg'), true);
  assert.equal(rules.isBinary('web/design/vendor/model-icons/libtv.svg'), true);
  assert.equal(rules.isBinary('frontend/src/features/table/table.mjs'), false);
  assert.equal(rules.isBinary('web/features/table/README.md'), false);
});

test('nested binary products keep every byte, including CR bytes inside a PNG signature', () => {
  const root = fixtureRoot(ATTRIBUTES);
  const rules = loadTextRules(root);
  // A real PNG header plus CRLF bytes that a text normaliser would rewrite.
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from([0x00, 0x00, 0x0d, 0x0a, 0xff, 0x0d, 0x0a, 0x7f]),
  ]);
  assert.deepEqual(productBytes('frontend/src/assets/nested/deep/picture.png', png, rules), png);
  assert.deepEqual(productBytes('frontend/src/design/vendor/model-icons/libtv.svg', Buffer.from('<svg>\r\n</svg>'), rules), Buffer.from('<svg>\r\n</svg>'));
  // CRLF is removed only for text paths.
  const text = Buffer.from('line one\r\nline two\r\n');
  assert.deepEqual(productBytes('frontend/src/features/app.mjs', text, rules), Buffer.from('line one\nline two\n'));
});

test('a consistent build passes the manifest check', () => {
  const root = fixtureRoot(ATTRIBUTES);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  writeProduct(root, 'assets/nested/deep/picture.png', png);
  writeProduct(root, 'features/app.mjs', Buffer.from('export const a = 1;\r\nexport const b = 2;\r\n'));
  writeManifest(root);
  assert.deepEqual(verifyBuildManifest(root).failures, []);
});

test('a product rewritten to CRLF is reported, because Git would hide that difference', () => {
  const root = fixtureRoot(ATTRIBUTES);
  writeProduct(root, 'features/app.mjs', Buffer.from('export const a = 1;\n'));
  writeManifest(root);
  assert.deepEqual(verifyBuildManifest(root).failures, []);

  const productPath = path.join(root, 'web/features/app.mjs');
  fs.writeFileSync(productPath, Buffer.from('export const a = 1;\r\n'));
  const { failures } = verifyBuildManifest(root);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /features\/app\.mjs: manifest sha256 .* does not match the file/);
});

test('a product whose bytes were truncated by a normaliser is reported', () => {
  const root = fixtureRoot(ATTRIBUTES);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  writeProduct(root, 'assets/nested/deep/picture.png', png);
  writeManifest(root);
  assert.deepEqual(verifyBuildManifest(root).failures, []);

  // A normaliser that treats the nested PNG as text would delete the CR byte.
  const productPath = path.join(root, 'web/assets/nested/deep/picture.png');
  fs.writeFileSync(productPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0a, 0x1a, 0x0a]));
  const { failures } = verifyBuildManifest(root);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /picture\.png: manifest sha256 .* does not match the file/);
});

test('an unlisted product, a missing product and a stale fingerprint are all reported', () => {
  const root = fixtureRoot(ATTRIBUTES);
  writeProduct(root, 'features/app.mjs', Buffer.from('export const a = 1;\n'));
  writeManifest(root);

  fs.writeFileSync(path.join(root, 'web/features/extra.mjs'), Buffer.from('export const extra = 1;\n'));
  const withExtra = verifyBuildManifest(root).failures;
  assert.ok(withExtra.some(failure => /extra\.mjs: present in web\/ but absent from the manifest/.test(failure)));

  fs.unlinkSync(path.join(root, 'web/features/extra.mjs'));
  fs.unlinkSync(path.join(root, 'web/features/app.mjs'));
  const withMissing = verifyBuildManifest(root).failures;
  assert.ok(withMissing.some(failure => /app\.mjs: listed in the manifest but missing from web\//.test(failure)));

  writeProduct(root, 'features/app.mjs', Buffer.from('export const a = 1;\n'));
  fs.writeFileSync(path.join(root, 'frontend/src/features/app.mjs'), Buffer.from('export const a = 2;\n'));
  const withStale = verifyBuildManifest(root).failures;
  assert.ok(withStale.some(failure => /sourceFingerprint .* does not describe frontend\/src/.test(failure)));
});
