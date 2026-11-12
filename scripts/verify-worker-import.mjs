import assert from "node:assert/strict";
import { readFile, readdir, realpath } from "node:fs/promises";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, SourceTextModule } from "node:vm";
import { webcrypto } from "node:crypto";
import * as idb from "fake-indexeddb";

// Execute the actual production module graph, not Vite's source-test transform.
// A fresh fake IndexedDB avoids any access to the user's extension data.
const root = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), "../dist"));
const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
let listener;
const event = { addListener() {} };
const context = createContext({
  console, ...idb, indexedDB: new idb.IDBFactory(), crypto: webcrypto,
  TextEncoder, TextDecoder, URL, URLSearchParams, Blob, Response, Request, Headers,
  AbortController, AbortSignal, DOMException, Event, performance, navigator: {},
  setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
  fetch: () => { throw new Error("Unexpected network request in worker import test"); },
  chrome: {
    action: { onClicked: event }, alarms: { onAlarm: event }, tabs: { onUpdated: event },
    runtime: { onInstalled: event, onStartup: event, onMessage: { addListener(fn) { listener = fn; } }, sendMessage: async () => undefined },
  },
});
assert.equal(context.document, undefined);
assert.equal(context.window, undefined);
const modules = new Map();
async function moduleAt(path) {
  path = resolve(path);
  assert.ok(!relative(root, path).startsWith(".."), "Worker imports must stay in the build");
  if (!modules.has(path)) modules.set(path, new SourceTextModule(await readFile(path, "utf8"), {
    context, identifier: path,
    initializeImportMeta(meta) { meta.url = new URL(`file:///${path.replaceAll("\\", "/")}`).href; },
    async importModuleDynamically(specifier, importer) {
      const loaded = await moduleAt(resolve(dirname(importer.identifier), specifier));
      if (loaded.status === "unlinked") await loaded.link(linker);
      if (loaded.status === "linked") await loaded.evaluate();
      return loaded;
    },
  }));
  return modules.get(path);
}
const linker = (specifier, importer) => moduleAt(resolve(dirname(importer.identifier), specifier));
const entry = await moduleAt(resolve(root, manifest.background.service_worker));
await entry.link(linker); await entry.evaluate();
assert.equal(typeof listener, "function");
const conversationId = "worker-dom-regression";
const capture = (content, capturedAt) => ({
  conversation: { id: conversationId, title: "Worker import", platform: "chatgpt", url: "", updatedAt: capturedAt, messageCount: 1 },
  messages: [{ id: "worker-message", conversationId, platformMessageId: "worker-message", content, preview: content, role: "assistant", messageIndex: 0, contentHash: content, createdAt: 1, updatedAt: capturedAt }],
  capturedAt,
});
async function send(content, at) {
  let timer;
  try {
    const response = await Promise.race([
      new Promise(resolveReply => listener({ type: "ATLAS_CAPTURE_BATCH", capture: capture(content, at) }, {}, resolveReply)),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Worker did not reply")), 5000); }),
    ]);
    assert.equal(response?.ok, true, `Production worker capture failed: ${JSON.stringify(response)}`);
  } finally { clearTimeout(timer); }
}
await send("Original imported content", 1);
await send("Original imported content", 2);
await send("Updated imported content", 3);
await new Promise(resolveWait => setTimeout(resolveWait, 20));
const databases = await context.indexedDB.databases();
assert.equal(databases.length, 1);
const request = context.indexedDB.open(databases[0].name);
const db = await new Promise((resolveDb, reject) => { request.onsuccess = () => resolveDb(request.result); request.onerror = () => reject(request.error); });
const read = store => new Promise((resolveRows, reject) => { const req = db.transaction(store).objectStore(store).getAll(); req.onsuccess = () => resolveRows(req.result); req.onerror = () => reject(req.error); });
const rows = await read("messages");
assert.equal(rows.length, 1); assert.equal(rows[0].content, "Updated imported content");
assert.equal((await read("conversations"))[0].messageCount, 1);
assert.equal(await read("messageSearchDocuments").then(rows => rows.length), 0, "Import worker must not eagerly load a page's search index");
// Exercise the production async reply boundary with a closed content channel.
Object.assign(context.chrome.runtime, { getURL: path => `chrome-extension://atlas/${path}`, getManifest: () => manifest });
Object.assign(context.chrome.tabs, {
  get: async () => ({ id: 42, active: true, url: `https://chatgpt.com/c/${conversationId}` }),
  sendMessage: async (_tabId, message) => {
    if (message.type === "ATLAS_PING") return { ready: true };
    throw new Error("A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received");
  },
});
let sidecarTimer;
try {
  const response = await Promise.race([
    new Promise(resolveReply => {
      assert.equal(listener({ type: "ATLAS_SIDECAR_SYNC", conversationId, tabId: 42 }, { url: "chrome-extension://atlas/sidecar.html?native=1" }, resolveReply), true);
    }),
    new Promise((_, reject) => { sidecarTimer = setTimeout(() => reject(new Error("Production sidecar failure did not reply")), 5000); }),
  ]);
  assert.equal(response?.ok, false); assert.match(response.error, /reach the ChatGPT page/u);
} finally { clearTimeout(sidecarTimer); }
const exportEntry = (await readdir(resolve(root, "assets"))).find(name => /^export-import-worker-.+\.js$/u.test(name));
assert.ok(exportEntry, "The production file-import worker must exist");
const exporter = await moduleAt(resolve(root, "assets", exportEntry));
await exporter.link(linker); await exporter.evaluate();
let exportTimer;
try {
  const done = new Promise((resolveExport, reject) => {
    context.postMessage = response => {
      if (response.type === "done") resolveExport(response.progress);
      if (response.type === "error") reject(new Error(response.message));
    };
    exportTimer = setTimeout(() => reject(new Error("Export import worker did not reply")), 5000);
  });
  const record = { id: "worker-export", title: "JSON import", current_node: "answer", mapping: { answer: { message: { id: "answer", author: { role: "assistant" }, content: { parts: ["Imported JSON source"] } } } } };
  context.onmessage({ data: { file: { name: "conversations.json", text: async () => JSON.stringify([record]) } } });
  const progress = await done;
  assert.equal(progress.failed, 0); assert.equal(progress.added, 1); assert.equal(progress.messages, 1);
  const saved = await read("messages");
  assert.equal(saved.length, 2); assert.ok(saved.some(message => message.content === "Imported JSON source"));
} finally { clearTimeout(exportTimer); }
// Optional capture must use the emitted standalone file and reject writes after disable.
const optionalSettings = {}, registeredReaders = new Map();
context.chrome.storage = { local: { get: async () => ({...optionalSettings}), set: async values => Object.assign(optionalSettings, values) } };
context.chrome.permissions = { contains: async ({origins}) => origins.every(origin => origin === "https://claude.ai/*") };
context.chrome.tabs.query = async () => [];
context.chrome.scripting = {
  getRegisteredContentScripts: async ({ids}) => ids.flatMap(id => registeredReaders.has(id) ? [registeredReaders.get(id)] : []),
  registerContentScripts: async records => { for(const record of records)registeredReaders.set(record.id, record); },
  unregisterContentScripts: async ({ids}) => { for(const id of ids)registeredReaders.delete(id); },
};
async function optionalCommand(message, sender = {}) {
  let timer;
  try { return await Promise.race([
    new Promise(resolveReply => listener(message, sender, resolveReply)),
    new Promise((_, reject) => { timer=setTimeout(()=>reject(new Error("Optional capture did not reply")),5000); }),
  ]); } finally { clearTimeout(timer); }
}
assert.equal((await optionalCommand({type:"ATLAS_WEB_CAPTURE_SET",platform:"claude",enabled:true})).ok,true);
const registeredReader=registeredReaders.get("atlas-web-capture-claude");
assert.ok(registeredReader?.js.length === 1);
const readerFile=resolve(root,registeredReader.js[0]);
assert.ok(!relative(root,readerFile).startsWith(".."));
assert.ok((await readFile(readerFile,"utf8")).length>0,"Registered page reader must exist in the production build");
const optionalCapture={...capture("Optional page content",4),conversation:{...capture("",4).conversation,id:"claude:worker-page",platform:"claude",source:"claude_dom",url:"https://claude.ai/chat/worker-page"},messages:[{...capture("Optional page content",4).messages[0],id:"claude:worker-page:answer",conversationId:"claude:worker-page"}]};
const optionalSender={url:"https://claude.ai/chat/worker-page"};
assert.equal((await optionalCommand({type:"ATLAS_CAPTURE_BATCH",capture:optionalCapture},optionalSender)).ok,true);
assert.ok((await read("messages")).some(message=>message.content==="Optional page content"));
assert.equal((await optionalCommand({type:"ATLAS_WEB_CAPTURE_SET",platform:"claude",enabled:false})).ok,true);
assert.equal(registeredReaders.size,0);
assert.equal((await optionalCommand({type:"ATLAS_CAPTURE_BATCH",capture:optionalCapture},optionalSender)).ok,false);

const analysisEntry = (await readdir(resolve(root, "assets"))).find(name => /^project-analysis-worker-.+\.js$/u.test(name));
assert.ok(analysisEntry, "The production project analysis worker must exist");
const analysis = await moduleAt(resolve(root, "assets", analysisEntry));
await analysis.link(linker); await analysis.evaluate();
const runId = "worker-project-run", otherRunId = "worker-other-run";
const records = db.transaction(["organizationRuns", "aiUsageEvents", "focusSessions"], "readwrite");
records.objectStore("organizationRuns").put({ id: runId, title: "Project", targetType: "conversation", targetIds: [conversationId], startedAt: 1, updatedAt: 1, status: "completed", stage: "proposal_ready", progress: 100, events: [] });
records.objectStore("aiUsageEvents").put({ id: otherRunId, runId: otherRunId, createdAt: 2, taskType: "other", providerId: "test", modelId: "test", conversationIds: [], inputTokens: 0, outputTokens: 0, tokenSource: "provider", status: "completed", attempt: 1 });
records.objectStore("focusSessions").put({ id: "worker-project", runId, title: "Project", goal: "Project", mode: "work", locale: "en", sourceConversationIds: [conversationId], createdAt: 1, updatedAt: 1,
  activeSectionId: "one", completedSectionIds: [], notes: "", evidence: [], sections: [{ id: "one", title: "Workflow", kind: "finding", body: "A named character reference &copy; in a saved chapter.", evidenceIds: [] }] });
await new Promise((resolveWrite, reject) => { records.oncomplete = resolveWrite; records.onabort = () => reject(records.error); });
let analysisTimer;
try {
  const result = await new Promise((resolveAnalysis, reject) => {
    context.postMessage = resolveAnalysis;
    analysisTimer = setTimeout(() => reject(new Error("Project analysis worker did not reply")), 5000);
    context.onmessage({ data: { runId, sourceConversationIds: [conversationId] } });
  });
  assert.equal(result.error, undefined);
  assert.ok(result.csv?.includes(`"${runId}"`));
  assert.ok(!result.csv.includes(otherRunId));
} finally { clearTimeout(analysisTimer); }
db.close();
console.info("ATLAS_WORKER_IMPORT_OK: production capture, optional reader, JSON import and scoped analysis CSV passed without a DOM or user data.");
