import {test} from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {wikiQualityReport} from "./wiki-quality-report.mjs";

test("documented Node CLI accepts a fixture path and emits only the shared metric JSON",async()=>{
 const fixture=fileURLToPath(new URL("../src/test/fixtures/wiki-quality.md",import.meta.url));
 const cli=fileURLToPath(new URL("./wiki-quality-report.mjs",import.meta.url));
 const stdout=execFileSync(process.execPath,[cli,fixture],{encoding:"utf8"});
 assert.deepEqual(JSON.parse(stdout),await wikiQualityReport(fixture));
});
