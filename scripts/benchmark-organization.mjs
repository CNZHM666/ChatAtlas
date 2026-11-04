import {readFile,writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
import {summarizeAnalysisCsv,compareBenchmarks} from "../src/ai/organization-benchmark.mjs";

export async function benchmark(args) {
 const options={samples:[]};
 for(let i=0;i<args.length;i++){
  const key=args[i],value=args[++i];
  if(!value||value.startsWith("--"))throw new Error(`Missing value for ${key}`);
  if(key==="--sample")options.samples.push(value);
  else if(["--before","--after","--json"].includes(key))options[key.slice(2)]=value;
  else throw new Error(`Unknown option: ${key}`);
 }
 if(!options.samples.length||!options.before)throw new Error("Usage: node scripts/benchmark-organization.mjs --sample redacted-export.json --before baseline.csv [--after candidate.csv] [--json report.json]");
 const samples=await Promise.all(options.samples.map(async path=>{const bytes=await readFile(path);if(!bytes.length)throw new Error("Empty sample");return {bytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex")};}));
 const before=summarizeAnalysisCsv(await readFile(options.before,"utf8")),after=options.after?summarizeAnalysisCsv(await readFile(options.after,"utf8")):undefined;
 const report={version:1,samples,before,...(after?{after,differences:compareBenchmarks(before,after)}:{})};
 console.log("Local benchmark; samples are fingerprinted only. Confirm identical scope/models and review Wiki quality separately.");
 console.log(JSON.stringify({samples,before,after},null,2));
 if(report.differences)console.table(report.differences);
 if(options.json)await writeFile(options.json,JSON.stringify(report,null,2)+"\n");
 return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)benchmark(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
