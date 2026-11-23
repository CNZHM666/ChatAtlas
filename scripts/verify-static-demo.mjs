import assert from "node:assert/strict";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";

const root = new URL("../dist-demo/", import.meta.url);
const files = await readdir(root, { recursive: true });
assert.ok(files.includes("index.html"), "Pages needs a root index.html");
const forbidden = /(?:^|[\\/])(?:manifest\.json|(?:[^\\/]*-)?(?:service.worker|background|content.script|sidecar|project-analysis-worker|project-analysis-csv)(?:[.\\/-]|$))/iu;
assert.deepEqual(files.filter(file => file !== path.join(".vite", "manifest.json") && forbidden.test(file)), []);

const inventory = new URL(".vite/manifest.json", root);
const entries = JSON.parse(await readFile(inventory, "utf8"));
assert.deepEqual(Object.keys(entries).filter(key => entries[key].isEntry), ["index.html"]);
assert.ok(!Object.keys(entries).some(key => /(?:background|content|sidecar)[/\\]|demo-api/iu.test(key)));
const html = await readFile(new URL("index.html", root), "utf8");
const expectedBase = "/" + (process.env.DEMO_BASE_PATH || "/ChatAtlas/").split("/").filter(Boolean).join("/");
const prefix = expectedBase.endsWith("/") ? expectedBase : expectedBase + "/";
const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/gu)].map(match => match[1]);
assert.ok(assets.length >= 2, "The entry and stylesheet should be present");
for (const asset of assets) {
  assert.ok(asset.startsWith(prefix), "Unexpected asset base: " + asset);
  assert.ok((await stat(new URL(asset.slice(prefix.length), root))).isFile(), "Missing asset: " + asset);
}
await rm(inventory);
console.log("CHATATLAS_STATIC_DEMO_OK " + prefix);
