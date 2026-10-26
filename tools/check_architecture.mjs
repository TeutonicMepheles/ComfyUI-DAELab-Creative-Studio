import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'frontend/src');
export function checkArchitecture(source) {
const errors = [], modules = new Map();
const dependencies = new Map();
function visit(folder) {
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) visit(full);
    else if (/\.(?:m?js|ts)$/.test(entry.name)) modules.set(full, fs.readFileSync(full, 'utf8'));
  }
}
visit(source);
for (const [file, code] of modules) {
  const edges = [];
  const relative = path.relative(source, file).replaceAll('\\', '/');
  if (/\/extensions\/ComfyUI-DAELab-(?:Creative-Canvas|Custom-Nodes-Library)/.test(code)) errors.push(`${relative}: old package runtime URL`);
  if (/\b(?:eval|new Function)\s*\(/.test(code)) errors.push(`${relative}: dynamic code execution`);
  if (/\b(?:from\s*|import\s*\(?)['"]\/scripts\//.test(code) && !relative.startsWith('integrations/comfyui/')) errors.push(`${relative}: host import outside integration`);
  for (const match of code.matchAll(/(?:from\s*|import\s*\(?)['"](\.[^'"]+)['"]/g)) {
    const specifier = match[1].split('?')[0];
    let target = path.resolve(path.dirname(file), specifier);
    if (target.endsWith('.js') && !fs.existsSync(target) && fs.existsSync(target.slice(0, -3) + '.ts')) target = target.slice(0, -3) + '.ts';
    if (!target.startsWith(source + path.sep) || !fs.existsSync(target)) errors.push(`${relative}: unresolved import ${specifier}`);
    if (modules.has(target)) edges.push(target);
    const targetRelative = path.relative(source, target).replaceAll('\\', '/');
    if (/^(design|ui|contracts)\//.test(relative) && /^(features|application|integrations)\//.test(targetRelative)) errors.push(`${relative}: shared layer depends on ${targetRelative}`);
    if (/^(canvas|features)\//.test(relative) && /^integrations\//.test(targetRelative)) errors.push(`${relative}: core depends on integration ${targetRelative}`);
  }
  dependencies.set(file, edges);
}
const visited = new Set(), active = new Set(), stack = [];
function visitDependencies(file) {
  if (active.has(file)) {
    const cycle = [...stack.slice(stack.indexOf(file)), file].map(p => path.relative(source, p).replaceAll('\\', '/'));
    errors.push(`Circular dependency: ${cycle.join(' -> ')}`);
    return;
  }
  if (visited.has(file)) return;
  active.add(file); stack.push(file);
  for (const target of dependencies.get(file) || []) visitDependencies(target);
  stack.pop(); active.delete(file); visited.add(file);
}
for (const file of modules.keys()) visitDependencies(file);
return { errors, moduleCount: modules.size };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
const { errors, moduleCount } = checkArchitecture(source);
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`Architecture checks passed for ${moduleCount} frontend modules.`);
}
