import { readdir, readFile, writeFile, lstat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootFiles = ["package.json", "package-lock.json", "tsconfig.json", "tsconfig.app.json", "tsconfig.node.json", "atlas.html", "sidecar.html", "manifest.config.ts", "vite.config.ts", "vitest.config.ts", "vitest.slow.config.ts", "eslint.config.js", "README.md", "README.en.md", "ARCHITECTURE.md", "AI_WORKFLOWS.md", "PRODUCT_PRINCIPLES.md", "CHANGELOG.md", "CONTRIBUTING.md", "SECURITY.md", "LICENSE", ".gitignore", ".gitattributes", ".env.example"];
const docs = ["README.md", "GETTING_STARTED.md", "PRIVACY.md", "RELEASE_CHECKLIST.md", "FIRST_RELEASE_OVERVIEW.md", "CONTEXT.md", "THIRD_PARTY_NOTICES.md", "THIRD_PARTY_LICENSES.txt", "licenses/remark-math-MIT.txt", "examples/project-context-template.md", "NATIVE_HISTORY_IMPORT.md"];
const englishDocs=["README.md","GETTING_STARTED.md","PRIVACY.md","RELEASE_CHECKLIST.md","FIRST_RELEASE_OVERVIEW.md","CONTEXT.md","ARCHITECTURE.md","AI_WORKFLOWS.md","PRODUCT_PRINCIPLES.md","CONTRIBUTING.md","CHANGELOG.md","examples/project-context-template.md"];
async function walk(directory) {
  const result = [];
  for (const item of await readdir(path.join(root, directory), { withFileTypes: true })) {
    if (item.isSymbolicLink()) throw Error(`Public source cannot contain symlinks: ${directory}/${item.name}`);
    const name = `${directory}/${item.name}`;
    if (item.isDirectory()) result.push(...await walk(name)); else if (item.isFile()) result.push(name);
  }
  return result;
}

export async function publicSourceFiles() {
  return [...new Set([...rootFiles, ...docs.map(name => `docs/${name}`),...englishDocs.map(name=>`docs/en/${name}`), ...await walk("src"), ...await walk("scripts"), ...await walk(".github"), ...await walk("docs/handoff"), "evaluation/memory-search/cases.ts"])].sort();
}

export async function verifyPublicSource({ checkGit = true } = {}) {
  const files = await publicSourceFiles(), allowed = new Set(files);
  const issues = [];
  for (const name of files) {
    const bytes = await readFile(path.join(root, name));
    if (/^src\/assets\/brand\/(?:logo-(?:light|dark)|icon-(?:dark-)?(?:16|32|48|128))\.png$/u.test(name)) {
      if (bytes.length < 24 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" || bytes.toString("ascii", 12, 16) !== "IHDR") issues.push(`${name}: invalid brand PNG`);
      continue;
    }
    const text = bytes.toString("utf8");
    if (/(?:^|\/)(?:\.env(?!\.example$)|node_modules|dist|dist-dev|artifacts|deploy-output|release-output|archive)(?:\/|$)/u.test(name) || /\.(?:zip|log|pem|key)$/u.test(name)) issues.push(`${name}: non-public file`);
    // Report paths, never the matched credential or private text.
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{32,}|gh[pousr]_[A-Za-z0-9]{30,})\b/u.test(text)) issues.push(`${name}: possible credential`);
    if (/[A-Z]:[\\/]Users[\\/][^/\\\s]+[\\/](?:Desktop|AppData)[\\/]/u.test(text)) issues.push(`${name}: machine-specific user path`);
    if (/\.(?:md)$/u.test(name)) {
      for (const match of text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu)) {
        if (/^(?:[a-z]+:|#)/iu.test(match[1])) continue;
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(name), decodeURIComponent(match[1].split("#")[0])));
        if (!allowed.has(target)) issues.push(`${name}: link outside public source (${target})`);
      }
    }
  }
  if (checkGit) {
    let tracked;
    try { tracked = execFileSync("git", ["ls-files", "-z", "--cached"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\0").filter(Boolean); }
    catch { /* A source archive may not be a Git checkout. */ }
    if (tracked) for (const name of tracked) if (!allowed.has(name)) {
      // ls-files includes unstaged deletions. They cannot enter the working-tree
      // archive; existing files and even dangling symlinks must still be checked.
      try { await lstat(path.join(root, name)); }
      catch (error) { if (error.code === "ENOENT") continue; throw error; }
      issues.push(`${name}: tracked outside public source manifest`);
    }
  }
  if (issues.length) throw Error(`Public source check failed:\n${issues.join("\n")}`);
  return files;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = await verifyPublicSource();
  const at = process.argv.indexOf("--write-list");
  if (at >= 0) {
    if (!process.argv[at + 1]) throw Error("--write-list requires an output file");
    await writeFile(path.resolve(process.argv[at + 1]), `${files.join("\n")}\n`);
  }
  console.log(`CHATATLAS_PUBLIC_SOURCE_OK: ${files.length} files; current guide links and credential/path checks passed.`);
}
