import { createServer } from "vite";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const args=process.argv.slice(2),value=name=>{const at=args.indexOf(name);return at<0?undefined:args[at+1];};
const sampleFile=value("--sample");
if(!sampleFile)throw Error("Usage: node scripts/evaluate-context-handoff.mjs --sample <context.txt> [--out <directory>]");
const output=path.resolve(value("--out")??".qa/context-handoff"),server=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},define:{"import.meta.env.VITE_ATLAS_API_BASE_URL":JSON.stringify("")}});
try {
  const {buildProjectContext}=await server.ssrLoadModule("/src/context/engine.ts"),{formatContext}=await server.ssrLoadModule("/src/context/format.ts");
  const original=await readFile(sampleFile,"utf8"),projectName=original.match(/^# (.+)/mu)?.[1]??"Imported context";
  const body=original.split(/^## (?:来源|Sources)\s*$/mu)[0];
  // Imported TXT is only organized prose. No original message, confirmation or work status is invented.
  const articles=[...body.matchAll(/^### ([^\n]+)\n([\s\S]*?)(?=^### |$(?![\s\S]))/gmu)];
  const clean=text=>text.replace(/^\*\*待核实\*\*[^\n]*\n?/gmu,"").trim();
  const sections=articles.map((match,index)=>({id:`import-${index}`,title:match[1],body:clean(match[2]),transition:"",kind:"finding",evidenceIds:[]}));
  const session={id:"sample-review",mode:"work",title:projectName,goal:"",createdAt:0,updatedAt:0,sourceConversationIds:[],sections,evidence:[],activeSectionId:sections[0]?.id,completedSectionIds:[],notes:""};
  const knowledge={session,conversations:[],messages:[],sourcesStale:false,signature:"txt-only"};
  const base={zh:true,task:"",length:"detailed",mode:"full",sections:["overview","decisions","progress","next","wiki","history"]};
  const bundles={full:buildProjectContext(knowledge,base),task:buildProjectContext(knowledge,{...base,mode:"task",task:"继续开发旧元件视觉识别功能"})};
  const metrics=text=>({characters:text.length,repeatedUncertaintyLabels:(text.match(/\*\*待核实\*\*/gu)??[]).length,internalIds:(text.match(/(?:conversationId|messageId):/gu)??[]).length,links:(text.match(/https:\/\/chatgpt\.com\/c\//gu)??[]).length,ir:text.includes("Hardware IR"),operation:text.includes("HardwareOperation"),executor:text.includes("Deterministic Executor")||text.includes("确定性执行器"),unknownTask:text.includes("当前任务未指定"),progressGap:text.includes("未找到可用的当前进度记录")});
  const texts=Object.fromEntries(Object.entries(bundles).map(([name,bundle])=>[name,formatContext(bundle)]));
  const report={sample:path.basename(sampleFile),provenance:"actual user export; treated as legacy Wiki prose only",paidModelCalls:0,rawMessagesAvailable:false,measures:{before:metrics(original),full:metrics(texts.full),task:metrics(texts.task)},limitations:["This comparison measures assembly and formatting, not factual extraction accuracy.","The original TXT has no raw messages or independently grounded progress records. M2 completion, actual implementation and current decisions cannot be recovered or upgraded.","No fresh AI comprehension score has been measured. Use the accompanying blind-review worksheet without giving the reviewer the original history."]};
  await mkdir(output,{recursive:true});
  for(const [name,text] of Object.entries(texts))await writeFile(path.join(output,`${name}.md`),text);
  await writeFile(path.join(output,"report.json"),JSON.stringify(report,null,2));
  await writeFile(path.join(output,"blind-review.md"),[
    "# Context handoff blind review", "Give only full.md or task.md to an AI with no project history. Keep answers and this checklist separate from the packet.",
    "1. What is the product and who uses it? Cite the packet.","2. Explain Hardware IR and the execution chain. Distinguish documented design from verified implementation.",
    "3. Has Milestone 2 actually shipped or passed tests? If the evidence is missing, say so.","4. Which decisions were explicitly confirmed, and which are suggestions or uncertain background?",
    "5. What obsolete approach should not be revived? If not established, say so.","6. What is the current task and what is known about its progress? Do not invent next steps.",
    "Score each answer as supported / unsupported / missing. Record exact packet passages and hallucinations. Do not treat fluent prose as correctness.",
    "Current run: no external model used; understanding accuracy is unmeasured. Original messages are needed to evaluate actual M2 progress or user acceptance."
  ].join("\n\n"));
  console.log(JSON.stringify(report));
}finally{await server.close();}
