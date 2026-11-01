// Shared byte rules for the frontend build and its manifest check.
//
// The repository stores text as LF (see .gitattributes). Git normalises on commit, so a
// working tree with core.autocrlf=true can hold CRLF bytes that Git reports as unmodified.
// Hashing or copying those bytes would make web/build-manifest.json depend on the machine
// that ran the build.
//
// Paths marked `-text` in .gitattributes are copied byte-for-byte by Git, so their working
// bytes already equal the committed bytes and must not be rewritten here.
import fs from 'node:fs';
import path from 'node:path';

function globToRegExp(glob) {
  let pattern = '';
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === '*') {
      if (glob[index + 1] === '*') {
        pattern += '.*';
        index += 1;
      } else {
        pattern += '[^/]*';
      }
    } else if (char === '?') {
      pattern += '[^/]';
    } else {
      pattern += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  // As in .gitattributes and .gitignore, a pattern without a slash matches at any depth,
  // so `*.png` must also cover nested images. A pattern containing a slash is anchored
  // to the repository root.
  const depth = glob.includes('/') ? '' : '(?:.*/)?';
  return new RegExp(`^${depth}${pattern}$`);
}

// Collect the `-text` patterns from .gitattributes so binary and vendor assets stay verbatim.
export function loadTextRules(repoRoot) {
  const attributesPath = path.join(repoRoot, '.gitattributes');
  const binary = [];
  if (fs.existsSync(attributesPath)) {
    for (const raw of fs.readFileSync(attributesPath, 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const [glob, ...flags] = line.split(/\s+/);
      if (flags.includes('-text')) binary.push(globToRegExp(glob));
    }
  }
  const isBinary = repoRelativePath => binary.some(matcher => matcher.test(repoRelativePath));
  return {
    isBinary,
    isText: repoRelativePath => !isBinary(repoRelativePath),
  };
}

// Remove CR bytes that immediately precede LF; leave every other byte untouched.
export function normalizeLineEndings(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.includes(13)) return bytes;
  const out = Buffer.allocUnsafe(bytes.length);
  let written = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] === 13 && bytes[index + 1] === 10) continue;
    out[written] = bytes[index];
    written += 1;
  }
  return out.subarray(0, written);
}

// Bytes as they will be committed for a text path, regardless of the local line endings.
export function productBytes(repoRelativePath, bytes, rules) {
  return rules.isText(repoRelativePath) ? normalizeLineEndings(bytes) : bytes;
}
