import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const dist = new URL('../dist/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('.vite/manifest.json', dist), 'utf8'));
const entryKey = Object.keys(manifest).find((key) => manifest[key].isEntry);
const terminalKey = 'src/components/SketchTerminal.tsx';
assert(entryKey, 'Build must have an entry point');
assert(manifest[terminalKey]?.isDynamicEntry, 'Terminal must be a dynamic entry');

function reachable(key, includeDynamic = false, found = new Set()) {
  if (found.has(key)) return found;
  assert(manifest[key], `Missing manifest entry: ${key}`);
  found.add(key);
  const imports = manifest[key].imports ?? [];
  const dynamicImports = includeDynamic ? manifest[key].dynamicImports ?? [] : [];
  for (const dependency of [...imports, ...dynamicImports]) reachable(dependency, includeDynamic, found);
  return found;
}

const initial = reachable(entryKey);
assert(!initial.has(terminalKey), 'Terminal must not be statically imported by the initial board');
assert(reachable(entryKey, true).has(terminalKey), 'Terminal must remain reachable by dynamic import');
const initialStyles = new Set([...initial].flatMap((key) => manifest[key].css ?? []));
const terminalStyles = manifest[terminalKey].css ?? [];
assert(terminalStyles.length > 0, 'Terminal must have a route stylesheet');
assert(terminalStyles.every((file) => !initialStyles.has(file)), 'Terminal CSS must not be in the initial route');
for (const key of initial) {
  const file = manifest[key].file;
  const bytes = readFileSync(new URL(file, dist));
  console.log(`Initial JS ${file}: ${bytes.length} bytes (${gzipSync(bytes).length} gzip)`);
}
assert(readFileSync(new URL(manifest[terminalKey].file, dist)).length > 0);
console.log(`Route chunk checks passed: ${fileURLToPath(dist)} (terminal JS/CSS deferred).`);
