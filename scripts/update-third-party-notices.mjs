import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(await readFile(path.join(root, "package-lock.json"), "utf8"));
const notices = [], licenses = [], seen = new Set();
for (const [location, metadata] of Object.entries(lock.packages)) {
  if (!location || metadata.dev) continue;
  const directory = path.join(root, location);
  const pkg = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
  const identity = `${pkg.name}@${pkg.version}`;
  if (seen.has(identity)) continue;
  seen.add(identity);
  const files = (await readdir(directory)).filter(name => /^(?:licen[sc]e|copying|notice)(?:[.-]|$)/iu.test(name)).sort();
  const monorepoLicense = ["rehype-katex@7.0.1", "remark-math@6.0.0"].includes(identity);
  if (!files.length && !monorepoLicense) throw Error(`Review missing license text: ${identity}`);
  notices.push(`| ${pkg.name} | ${pkg.version} | ${typeof pkg.license === "string" ? pkg.license : "See license text"} |`);
  const texts = [];
  for (const file of files) texts.push(`--- ${file} ---\n${await readFile(path.join(directory, file), "utf8")}`);
  if (!files.length) texts.push(await readFile(path.join(root, "docs/licenses/remark-math-MIT.txt"), "utf8"));
  licenses.push(`===== ${identity} =====\n\n${texts.join("\n\n")}`);
}
notices.push("| @lobehub/icons-static-svg (selected local assets) | 1.97.0 | MIT |");
licenses.push(`===== @lobehub/icons-static-svg@1.97.0 (selected local SVG assets) =====\nSource: https://github.com/lobehub/lobe-icons\n\n${await readFile(path.join(root,"src/assets/ai/LICENSE.txt"),"utf8")}`);
await writeFile(path.join(root, "docs/THIRD_PARTY_NOTICES.md"), `# ChatAtlas third-party notices\n\nGenerated from the locked runtime dependency tree and selected bundled assets using \`npm run notices\`. Development tools are not bundled as runtime dependencies. Each component retains its own copyright and license. Full distributed license texts are in [THIRD_PARTY_LICENSES.txt](THIRD_PARTY_LICENSES.txt). This inventory is not a claim that every installed module is shipped in every bundle.\n\n| Component | Version | Declared license |\n| --- | --- | --- |\n${notices.sort().join("\n")}\n`);
await writeFile(path.join(root, "docs/THIRD_PARTY_LICENSES.txt"), `ChatAtlas runtime dependency and bundled asset license texts\nGenerated from package-lock.json, installed packages and selected local assets.\n\n${licenses.sort().join("\n\n")}\n`);
console.log(`Updated notices for ${seen.size} runtime packages.`);
