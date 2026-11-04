// Score an exported Wiki against labelled cases:
//   npm run eval:wiki -- <cases.json> <export.md> [more-exports.md…] [ai-organization-analysis.csv] [knowledge-units.json]
// Several exports of the same pipeline are averaged: one run moves by a few cases.
// A ledger beside a document lets "findable" cases look one step away; a ledger alone is scored as the ledger.
// Private cases and reports belong in evaluation/<name>/ (cases.json and report.* are gitignored).
import {readFile,writeFile} from "node:fs/promises";
import {dirname,join} from "node:path";
import {pathToFileURL,fileURLToPath} from "node:url";
import {build} from "esbuild";

/** The newest run in an exported analysis CSV: requests, tokens and wall time. */
export function latestRun(csv){
 const rows=[];let row=[],field="",quoted=false;
 const text=csv.charCodeAt(0)===0xFEFF?csv.slice(1):csv;
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){if(c==='"'&&text[i+1]==='"'){field+='"';i++;}else if(c==='"')quoted=false;else field+=c;continue;}
  if(c==='"')quoted=true;else if(c===","){row.push(field);field="";}else if(c==="\n"||c==="\r"){if(c==="\r"&&text[i+1]==="\n")i++;row.push(field);rows.push(row);row=[];field="";}else field+=c;
 }
 if(field||row.length){row.push(field);rows.push(row);}
 const [header,first]=rows;if(!header||!first)return undefined;
 const get=name=>{const value=Number(first[header.indexOf(name)]);return Number.isFinite(value)?value:undefined;};
 const elapsed=get("elapsed_ms");
 return {requests:get("requests"),inputTokens:get("input_tokens"),outputTokens:get("output_tokens"),...(elapsed!==undefined?{elapsedSeconds:Math.round(elapsed/1000)}:{})};
}

export async function evaluateWiki(casesPath,exportPath,csvPath,ledgerPath){
 // The scorer is TypeScript shared with the regression test; esbuild bundles it in memory.
 const result=await build({entryPoints:[fileURLToPath(new URL("../src/test/wiki-eval.ts",import.meta.url))],bundle:true,write:false,format:"esm",platform:"node"});
 const {scoreWikiEvaluation,scoreWikiLedger}=await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
 const cases=JSON.parse(await readFile(casesPath,"utf8"));
 const run=csvPath?latestRun(await readFile(csvPath,"utf8")):undefined;
 // A ledger export (redesign P1) is scored on its own: adoption, details and coverage.
 if(exportPath.endsWith(".json")){const data=JSON.parse(await readFile(exportPath,"utf8"));return {...scoreWikiLedger(data.ledger??data,cases),...(run?{run}:{}),ledger:true};}
 const ledger=ledgerPath?JSON.parse(await readFile(ledgerPath,"utf8")):undefined;
 return scoreWikiEvaluation(await readFile(exportPath,"utf8"),cases,run,ledger?.ledger??ledger);
}

/** Several exports scored alike: each run's score, the mean and range, and how often each case passed. */
export async function evaluateRuns(casesPath,exportPaths,csvPath,ledgerPath){
 const runs=[];for(const path of exportPaths)runs.push({path,report:await evaluateWiki(casesPath,path,csvPath,ledgerPath)});
 const scores=runs.map(run=>run.report.score),mean=Math.round(scores.reduce((sum,score)=>sum+score,0)/scores.length*10)/10;
 const cases=runs[0].report.results.map((result,index)=>({id:result.id,type:result.type,passed:runs.filter(run=>run.report.results[index].pass).length,details:runs.map(run=>run.report.results[index].detail)}));
 return {runs:runs.map(run=>({path:run.path,score:run.report.score,byType:run.report.byType,characters:run.report.shape.characters})),mean,min:Math.min(...scores),max:Math.max(...scores),cases};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [casesPath,...paths]=process.argv.slice(2),exports=paths.filter(path=>path.endsWith(".md")),csvPath=paths.find(path=>path.endsWith(".csv")),json=paths.find(path=>path.endsWith(".json"));
 const exportPath=exports[0]??json,ledgerPath=exports.length?json:undefined;
 if(exports.length>1)evaluateRuns(casesPath,exports,csvPath,ledgerPath).then(async summary=>{
  for(const run of summary.runs)console.log(`Run ${run.path}: ${run.score}/10 · ${run.characters} characters`);
  console.log("");
  for(const item of summary.cases)console.log(`${item.passed===summary.runs.length?"PASS":item.passed?"MIXED":"FAIL"} ${item.id.padEnd(4)} ${item.type.padEnd(10)} ${item.passed}/${summary.runs.length} · ${[...new Set(item.details)].join(" | ")}`);
  console.log(`\nMean ${summary.mean}/10 over ${summary.runs.length} runs (range ${summary.min}-${summary.max})`);
  const out=join(dirname(casesPath),"report.json");await writeFile(out,JSON.stringify(summary,null,2));console.log(`\nReport written to ${out}`);
 }).catch(error=>{console.error(error.message);process.exitCode=1;});
 else if(!casesPath||!exportPath){console.error("Usage: npm run eval:wiki -- <cases.json> <export.md> [more-exports.md…] [analysis.csv] [knowledge-units.json]");process.exitCode=1;}
 else evaluateWiki(casesPath,exportPath,csvPath,ledgerPath).then(async report=>{
  for(const item of report.results)console.log(`${item.pass?"PASS":"FAIL"} ${item.id.padEnd(4)} ${item.type.padEnd(10)} ${item.detail}${item.needsReview?" (needs review, not scored)":""}`);
  console.log("");
  for(const [type,row] of Object.entries(report.byType))console.log(`${type.padEnd(10)} ${row.passed}/${row.total}`);
  if(report.ledger)console.log(`\nLedger: ${report.units} units from ${report.materials} materials (${Math.round(report.coverage*100)}% covered) · adoption ${JSON.stringify(report.adoption)} · ${report.reported} reported · ${report.pastedUnits} from pasted text · ${report.failedBatches} failed batches · rejected ${JSON.stringify(report.rejected)}`);
  if(report.organization){const o=report.organization;console.log(`Organization: ${o.subjects} subjects · ${o.chapters} chapters, ${o.subtopics} subtopics · ${o.mergedUnits} units merged · ${o.relations} relations (${o.unresolved} unresolved) · ${JSON.stringify(o.report)}`);}
  else if(!report.ledger)console.log(`\nScore ${report.score}/10 by case (${report.typeScore}/10 by type, the earlier measure) · ${report.shape.chapters} chapters, ${report.shape.subtopics} subtopics (max ${report.shape.maxSubtopics}, about ${report.shape.averageSubtopicCharacters} characters each) · ${report.shape.characters} characters · ${report.qualifiersPer1000} status qualifiers per 1000 characters · ${Math.round(report.sourcedParagraphs*100)}% paragraphs sourced`);
  if(report.groups){const g=report.groups;console.log(`Groups: ${g.cited} of ${g.groups} cited · explained twice ${g.explainedTwice} (${Math.round(g.explainedTwiceRate*1000)/10}%) · conditions lost ${g.conditionsLost} of ${g.conditions} (${Math.round(g.conditionLossRate*1000)/10}%) · rejected ${JSON.stringify(g.rejected)}`);}
  if(report.run)console.log(`Run: ${report.run.requests} requests, ${report.run.inputTokens} input / ${report.run.outputTokens} output tokens${report.run.elapsedSeconds!==undefined?`, ${report.run.elapsedSeconds} s`:""}`);
  const out=join(dirname(casesPath),"report.json");await writeFile(out,JSON.stringify(report,null,2));console.log(`\nReport written to ${out}`);
 }).catch(error=>{console.error(error.message);process.exitCode=1;});
}
