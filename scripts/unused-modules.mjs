// Fails when a source module cannot be reached from the extension's real entry
// points, so removed features do not linger as untested-in-use, tested-in-isolation code.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, "$1")), "..");
const src = path.join(root, "src");
const ENTRIES = ["src/canvas/main.tsx", "src/sidecar/main.tsx", "src/background/service-worker.ts", "src/content/chatgpt-content.ts", "manifest.config.ts"];

const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(tsx?|jsx?|mjs)$/u.test(entry.name) && !entry.name.endsWith(".d.ts")) files.push(full);
  }
})(src);

const testOnly = file => /\.test\.(tsx?|jsx?)$/u.test(file) || file.split(path.sep).includes("test");
const resolve = (from, spec) => {
  if (!spec.startsWith(".")) return undefined;
  const base = path.resolve(path.dirname(from), spec.replace(/\?.*$/u, ""));
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.mjs`, base.replace(/\.js$/u, ".ts"), path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return undefined;
};
// Static, type-only, side-effect and dynamic imports, `?script` imports and worker URLs.
const IMPORT = /(?:import|export)\s[^"'`;]*?from\s*["']([^"']+)["']|import\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|new URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url/gu;
const imports = file => {
  const found = new Set();
  for (const match of fs.readFileSync(file, "utf8").matchAll(IMPORT)) {
    const target = resolve(file, match[1] ?? match[2] ?? match[3] ?? match[4]);
    if (target) found.add(target);
  }
  return found;
};

const reached = new Set(), queue = ENTRIES.map(entry => path.join(root, entry));
while (queue.length) {
  const file = queue.pop();
  if (reached.has(file)) continue;
  reached.add(file);
  for (const next of imports(file)) if (!reached.has(next)) queue.push(next);
}
const unused = files.filter(file => !testOnly(file) && !reached.has(file)).map(file => path.relative(root, file).split(path.sep).join("/"));
if (unused.length) {
  console.error(`Unreachable source modules (${unused.length}). Delete them with their tests, or import them from a real entry point:\n${unused.map(file => `  ${file}`).join("\n")}`);
  process.exit(1);
}
console.log(`CHATATLAS_UNUSED_OK: ${reached.size} reachable modules, none unreachable.`);
