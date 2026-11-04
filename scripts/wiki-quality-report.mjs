import {readFile} from "node:fs/promises";
import {pathToFileURL,fileURLToPath} from "node:url";
import {build} from "esbuild";

export async function wikiQualityReport(path){
 // esbuild is already supplied by the repository's Vite toolchain. Bundle the
 // pure metric entry in memory so Node 22 can run the same TS as the frontend.
 const result=await build({entryPoints:[fileURLToPath(new URL("../src/shared/wiki-quality-metrics.ts",import.meta.url))],bundle:true,write:false,format:"esm",platform:"node",treeShaking:true,logLevel:"silent"});
 const {wikiQualityMetrics}=await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
 return wikiQualityMetrics(await readFile(path,"utf8"));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const path=process.argv[2];
 if(!path||process.argv.length!==3){console.error("Usage: node scripts/wiki-quality-report.mjs <export.md>");process.exitCode=1;}
 else wikiQualityReport(path).then(report=>console.log(JSON.stringify(report,null,2))).catch(error=>{console.error(error.message);process.exitCode=1;});
}
