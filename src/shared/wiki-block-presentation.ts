import {wikiHistoricalHeading,wikiHistoryLayout} from "./wiki-history-layout";
import { wikiDocumentBlocks } from "./wiki-document-blocks";
import {wikiExampleDisplayKey,wikiExampleKey,wikiExampleStage,wikiExampleStanding} from "./wiki-example-identity";
import { sourceMessageSignature } from "./source-signature";
import {wikiUiCopy,wikiUiCopySupports} from "./wiki-ui-copy";
import {isRequiredWikiSourceBlock} from "./wiki-source-code";
import type { WikiDraftChapter, WikiKnowledgeUnit } from "./wiki-knowledge";

import {plainBlockLayout,wikiLiteralText} from "./wiki-plain-block";
import {WIKI_SUPPLEMENT,wikiSupplementTitle,groupWikiSupplements,wikiSupplementRanges,normalizeWikiSupplementHeadings} from "./wiki-source-supplements";
export {WIKI_SUPPLEMENT} from "./wiki-source-supplements";
export interface WikiBlockAdmission {
  id: string;
  mode: "verbatim" | "reformat" | "supplement" | "source_only";
  format?: "inline" | "list" | "table" | "flow" | "groups" | "terms" | "progress";
  reason: string;
  language: string;
  unitIds: string[];
  sourceSignature: string;
}
interface SourceBlock { language: string; text: string }
const PLAIN = /^(?:text|plaintext|plain|txt|markdown|md)?$/iu;
const HISTORICAL = /早期|此前|已替换|earlier|replaced|superseded/iu;
const STRUCTURE = /[┌└├┤╭╰│┃]|^\s*(?:interface |export |type \w+\s*=|const |let |function |class |import |SELECT |CREATE )|^\s*[{[]/mu;
const CAPTION = /^\*{1,2}(?:讨论中的原文(?:代码|表格)|(?:Code|Table) from the discussion|对照表|命令|数据结构|代码示例|代码|界面草图|规则逻辑|事件清单|目录结构|提示词|计算规则|示例数据|界面文案|流程|对照|清单|Table|Commands|Data structure|Code example|Code|UI sketch|Rules|Event list|File layout|Prompt|Scoring|Sample data|UI copy|Flow|Mapping|List)(?:[^\n]*)\*{1,2}$/u;
const linesOf = (text: string) => text.split(/\r?\n/u).map(line => line.trim()).filter(Boolean);
const keyOf = (code: SourceBlock) => sourceMessageSignature(`${code.language}\n${code.text}`);
const codeOf = (markdown:string):SourceBlock|undefined=>{
 const opening=/^[ \t]*(`{3,}|~{3,})([^\n]*)\n/u.exec(markdown);
 if(opening)return {language:opening[2].trim(),text:markdown.slice(opening[0].length).replace(/\n[ \t]*(?:`{3,}|~{3,})[ \t]*$/u,"")};
};
/** A short label example adds nothing when every literal line is already stated
 * in the subsection's explanation. Never infer equivalence or remove diagrams. */
const redundantLabels=(code:SourceBlock,context:string)=>{
 if(!PLAIN.test(code.language)||STRUCTURE.test(code.text)||/[→↓]|->|=>/u.test(code.text))return false;
 const lines=linesOf(code.text),bare=(value:string)=>value.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]/gu,"");
 if(!lines.length||lines.length>7||lines.some(line=>line.length>60))return false;
 const prose=bare(wikiDocumentBlocks(context).filter(block=>["paragraph","list","table"].includes(block.kind)).map(block=>block.text).join("\n"));
 return lines.every(line=>bare(line).length>=2&&prose.includes(bare(line)));
};
/** Recheck saved application attachments too: otherwise old grouped examples
 * bypass admission forever. Only exact repetitions or fully explained labels go. */
function compactSavedExamples(body:string,zh:boolean,units:WikiKnowledgeUnit[]){
 body=normalizeWikiSupplementHeadings(body);
 const ranges=wikiSupplementRanges(body),blocks=wikiDocumentBlocks(body),seen=new Map<string,{title:string;literal:string;notes:string[]}>();
 const exterior=blocks.filter(block=>!ranges.some(([start,end])=>block.start>=start&&block.end<=end));
 const collections:Array<{start:number;end:number;raw:string;examples:Array<{title:string;literal:string;notes:string[]}>}>=[];
 for(const [start,end] of ranges){
  const raw=body.slice(start,end);
  const summary=/<summary>([^<>\n]+)<\/summary>/u.exec(raw)?.[1];
  if(!summary)continue;
  const heading=exterior.filter(block=>block.kind==="heading"&&block.start<start).at(-1);
  const prose=exterior.filter(block=>block.start>=(heading?.end??0)&&block.end<=start&&["paragraph","list","table"].includes(block.kind)).map(block=>block.text).join("\n\n");
  const items=blocks.filter(block=>block.start>start&&block.end<end);
  const examples:Array<{title:string;literal:string;notes:string[]}>=[];
  let pending="";
  let previousExample:typeof examples[number]|undefined;
  let supported=true;
  for(const item of items){
   if(item.kind==="paragraph"&&/^(?:原文来源|Original source|Source(?: references?)?)\s+\[S-[\w-]+\](?:\s*\[S-[\w-]+\])*$/u.test(item.text)){previousExample?.notes.push(item.text);continue;}
   if(item.kind==="heading"&&/^#{3,6} \d+\. /u.test(item.text)&&!pending){pending=item.text.replace(/^#{3,6} \d+\. /u,"");continue;}
   const code=item.kind==="code"?codeOf(item.text):undefined;
   if(!code){supported=false;break;}
   const caption=pending||summary;
   pending="";
   previousExample=undefined;
   const matching=units.filter(unit=>unit.evidence.code&&wikiExampleKey(unit.evidence.code)===wikiExampleKey(code));
   const decision=planWikiSourceBlock(code,"",matching,prose);
   if(decision.mode==="source_only"&&!/(?:项目发起人|你)(?:确认|提供)|(?:confirmed|provided) by you/iu.test(caption))continue;
   const title=/^(?:原文与示例|Originals and examples|参考示例|Reference example|流程示例|Flow example|原文示例|Source example|数据结构|Data structure|命令示例|Command example|JSON 示例|界面草图|UI sketch|目录结构|File layout)(?: · |$)/u.test(caption)
    ?wikiSupplementTitle(code,"",zh,heading?.text)+provenance(caption)
    :caption;
   previousExample={title,literal:item.text,notes:[]};
   examples.push(previousExample);
  }
  if(!supported||pending||!items.length)continue;
  // A literal may occur with a version caption and again without one. Keep
  // the original once within this topic and record the unlabelled occurrence.
  // Two explicit versions or distinct captions still get separate examples.
  const unlabelledCopies=new Set<typeof examples[number]>(),sharedTargets=new Set<typeof examples[number]>();
  for(const example of examples){
   if(wikiExampleStage(example.title))continue;
   const matches=examples.filter(candidate=>{
    if(candidate.literal!==example.literal||candidate===example) return false;
    const parts=candidate.title.split(" · ");
    const versions=parts.filter(part=>wikiExampleStage(part)===part.toLowerCase());
    return versions.length===1&&parts.filter(part=>!versions.includes(part)).join(" · ")===example.title;
   });
   // A repeated, explicitly labelled pair can share one literal only when its
   // version is unambiguous. Outside that case normal exact dedupe applies.
   if(!matches.length||new Set(matches.map(candidate=>wikiExampleStage(candidate.title))).size!==1)continue;
   const target=matches[0];
   sharedTargets.add(target);
   target.notes.push(...example.notes);
   unlabelledCopies.add(example);
  }
  for(const target of sharedTargets)target.title+=zh?" · 另有未标版本的相同原文":" · Also appeared without a version label";
  const kept=examples.filter(example=>{
   if(unlabelledCopies.has(example))return false;
   const {literal,title}=example;
   const code=codeOf(literal)!;
   const key=wikiExampleDisplayKey(code,wikiExampleStage(title,heading?.text??""),wikiExampleStanding(title));
   const prior=seen.get(key);
   if(prior){prior.notes.push(...example.notes);return false;}
   seen.set(key,example);return true;
  });
  collections.push({start,end,raw,examples:kept});
 }
 const edits:Array<{start:number;end:number;text:string}>=[];
 for(const {start,end,raw,examples:kept} of collections){
  const label=kept.length===1?kept[0].title:zh?`参考示例 · ${kept.length} 项`:`Reference examples · ${kept.length} items`;
  const contents=kept.map(({title,literal,notes},index)=>[kept.length===1?literal:`#### ${index+1}. ${title}\n\n${literal}`,...new Set(notes)].join("\n\n")).join("\n\n");
  const next=kept.length?`<details data-atlas="${WIKI_SUPPLEMENT}">\n<summary>${label}</summary>\n\n${contents}\n\n</details>`:"";
  if(next===raw)continue;
  edits.push({start,end,text:next});
 }
 for(const edit of edits.reverse())body=body.slice(0,edit.start)+edit.text+body.slice(edit.end);
 return body;
}
const provenance=(caption:string)=>caption.match(/ · (?:AI\s*建议|(?:项目发起人|你)(?:确认|提供)|以(?:项目发起人|你)后来的决定|confirmed by you|provided by you|AI suggestion|Earlier|早期方案).*$/iu)?.[0]??"";

export function planWikiSourceBlock(code: SourceBlock, caption = "", units: WikiKnowledgeUnit[] = [], context = ""): WikiBlockAdmission {
  const signature = keyOf(code), lines = linesOf(code.text);
  const result = (mode: WikiBlockAdmission["mode"], reason: string, format?: WikiBlockAdmission["format"]): WikiBlockAdmission => ({ id: `block:${signature}`, mode, reason, ...(format ? { format } : {}), language: code.language, unitIds: units.map(unit => unit.id), sourceSignature: signature });
  if (HISTORICAL.test(caption)) return result("source_only", "Historical examples remain in the original Reader instead of the article.");
  const required=units.some(isRequiredWikiSourceBlock);
  if(!required&&redundantLabels(code,context))return result("source_only","Every short example line is already explained here; its exact original stays in the source.");
 if(!required&&units.length&&PLAIN.test(code.language)&&lines.length===2&&wikiSupplementTitle(code,"",false)==="AI connection state")
    return result("source_only","A connected-state label and model name stay available in the source.");
  if (code.language === "table") return result("verbatim", "An original table preserves exact field/value associations.");
  const ui=wikiUiCopy(code);
  if(ui){
    const supported=units.filter(unit=>wikiUiCopySupports(code,unit));
    if(!required&&units.length&&!supported.length)return result("source_only", "UI copy is not supported by its associated claim; the original remains in Reader.");
    return {...result("supplement", "UI copy is an example, not standalone prose; retain it with an explicit purpose in the source attachment."),unitIds:supported.map(unit=>unit.id)};
  }
  if (!PLAIN.test(code.language)) {
    if(!required&&units.length&&/^(?:bash|sh|shell|zsh|powershell|ps1|cmd|console)$/iu.test(code.language)&&lines.length===1&&context.includes(lines[0]))
      return result("source_only","The exact command already appears in the explanation.");
    const declaration=/\b(?:interface|type|class)\s+([A-Za-z_$][\w$]*)/u.exec(code.text)?.[1];
    const dedicated=/^#{1,6}\s+[^\n]*(?:接口定义|接口契约|数据结构定义|模式定义|API contract|interface definition|schema definition)/imu.test(context);
    if(lines.length<=28&&declaration&&dedicated&&context.includes(declaration))return result("verbatim", "A named contract is explained in its own definition section; keep its exact syntax beside the explanation.");
    return result("supplement", "Literal preservation does not require inline display; examples remain complete in the subsection attachment.");
  }
  const layout=plainBlockLayout(code.text);
  if(layout)return result("reformat", "The original grouping and explicit relationships determine the layout.",layout.kind);
  if (STRUCTURE.test(code.text) || /界面草图|UI sketch|目录结构|file layout|提示词|prompt/iu.test(caption)) return result("supplement", "Layout-sensitive material remains intact in an optional source example.");
  if (lines.length === 1 && lines[0].length <= 120) {
    const value = lines[0];
    if (!required&&units.length && value.length >= 5 && !units.some(unit => `${unit.statement}\n${(unit.details ?? []).join("\n")}`.includes(value))) return result("source_only", "An isolated source label does not independently support its associated point.");
    return result("supplement", "An isolated source line has no independent explanatory context; retain it as an optional example.");
  }
  return result("supplement", "The block's original formatting is retained as optional detail.");
}

/** One shared Markdown projection for Wiki and every export. Originals and authored chapters are unchanged. */
export function wikiBlockPresentation(body: string, options: { zh?: boolean; units?: WikiKnowledgeUnit[] } = {}) {
  const zh = options.zh ?? true, blocks = wikiDocumentBlocks(body), decisions: WikiBlockAdmission[] = [], seen = new Set<string>();
  const edits: Array<{ start: number; end: number; text: string }> = [];
  let supplement = false, historicalDepth=0, sectionStart=0, topic="";
  // Older projections may have flattened source UI copy. Recover only exact ledger-backed matches.
  const legacyCopies=new Map<string,{code:SourceBlock;units:WikiKnowledgeUnit[]}>();
  for(const unit of options.units??[]){
    const code=unit.evidence.code;
    if(!code||!PLAIN.test(code.language)||(!wikiUiCopy(code)&&(linesOf(code.text).length<2||plainBlockLayout(code.text))))continue;
    const flat=linesOf(code.text).map(wikiLiteralText).join(" · "),entry=legacyCopies.get(flat)??{code,units:[]};
    entry.units.push(unit);legacyCopies.set(flat,entry);
  }
  for (const [index, block] of blocks.entries()) {
    if(block.kind==="heading"&&!supplement){
      sectionStart=block.start;
      topic=block.text;
      const depth=block.text.match(/^#+/u)?.[0].length??2;
      if(historicalDepth&&depth<=historicalDepth)historicalDepth=0;
      if(wikiHistoricalHeading(block.text))historicalDepth=depth;
    }
    if (block.kind === "html" && block.text.startsWith(`<details data-atlas="${WIKI_SUPPLEMENT}">`)) { supplement = true; continue; }
    if (supplement) { if (block.kind === "html" && /^<\/details>\s*$/u.test(block.text)) supplement = false; continue; }
    if(block.kind==="paragraph"){
      const legacy=legacyCopies.get(block.text.trim());
      if(legacy){
        const decision=planWikiSourceBlock(legacy.code,"",legacy.units);decisions.push(decision);
        const label=wikiSupplementTitle(legacy.code,"",zh,topic);
        const fence="`".repeat(Math.max(3,...[...legacy.code.text.matchAll(/`+/gu)].map(match=>match[0].length+1)));
        const original=`${fence}${legacy.code.language}\n${legacy.code.text}\n${fence}`;
        edits.push({start:block.start,end:block.end,text:historicalDepth||decision.mode==="source_only"?"":`<details data-atlas="${WIKI_SUPPLEMENT}">\n<summary>${zh?"补充资料":"Additional details"} · ${label}</summary>\n\n${original}\n\n</details>`});
      }
      continue;
    }
    if (block.kind !== "code") continue;
    const open = /^\s*(`{3,}|~{3,})([^\n]*)\n/u.exec(block.text);
    if (!open || open[2].trim() === "atlas-flow") continue;
    const text = block.text.slice(open[0].length).replace(/\n[ \t]*(?:`{3,}|~{3,})[ \t]*$/u, "");
    const code = { language: open[2].trim(), text };
    const previous = blocks[index - 1], caption = previous?.kind === "paragraph" && CAPTION.test(previous.text.trim()) ? previous.text.trim() : "";
    const units = (options.units ?? []).filter(unit => unit.evidence.code&&wikiExampleKey(unit.evidence.code)===wikiExampleKey(code));
    let decision = planWikiSourceBlock(code, caption, units, body.slice(sectionStart,block.start));
    if(historicalDepth)decision={...decision,mode:"source_only",reason:"Historical examples remain in the original Reader instead of the article."};
    const identity = wikiExampleDisplayKey(code,wikiExampleStage(caption,topic),wikiExampleStanding(caption));
    // The attachment pass can consolidate duplicate examples and collect both
    // source lines. An earlier pass must leave those lines with their block.
    if (decision.mode!=="supplement"&&seen.has(identity)) decision = { ...decision, mode: "source_only", reason: "The same literal block is already shown in this chapter." };
    if(decision.mode!=="source_only")seen.add(identity);
    decisions.push(decision);
    let replacement = block.text;
    if (decision.mode === "source_only") replacement = "";
    else if (decision.mode === "supplement") {
      // Restrict this to our own marker, not arbitrary imported HTML.
      const label = wikiSupplementTitle(code,caption,zh,topic);
      replacement = `<details data-atlas="${WIKI_SUPPLEMENT}">\n<summary>${zh ? "补充资料" : "Additional details"} · ${label}</summary>\n\n${block.text}\n\n</details>`;
    } else if (decision.mode === "reformat") {
      replacement = decision.format === "inline" ? wikiLiteralText(linesOf(code.text)[0]) : plainBlockLayout(code.text,zh)!.markdown;
      // A source-derived process inherits the caption's attribution and status.
      // The generic "source code" title alone does not describe the flow.
      if(decision.format==="flow"){
        const notes=caption.replace(/^\*+|\*+$/gu,"").split(/\s*·\s*/u).slice(1).filter(Boolean);
        const references=[...new Set(units.flatMap(unit=>unit.about?.role==="reference"?[unit.about.name.trim()]:[]))].filter(Boolean);
        if(references.length===1){
          const name=wikiLiteralText(references[0]);
          replacement=zh?`**${name} 参考流程**：${replacement}`:`**${name} reference flow**: ${replacement}`;
        }
        const status=notes.join(" · ").replace(/AI\s*建议/gu,"AI 建议").replace(/以你后来的决定为准|你随后的决定优先/gu,"以项目发起人后来的决定为准").replace(/你确认的|你提供的/gu,match=>match.replace("你","项目发起人"));
        if(status)replacement=zh?`${replacement}（${status}）`:`${replacement} (${status})`;
      }
    }
    if (replacement !== block.text) edits.push({ start: caption ? previous.start : block.start, end: block.end, text: replacement });
  }
  for (const edit of edits.reverse()) body = body.slice(0, edit.start) + edit.text + body.slice(edit.end);
  return { body: wikiHistoryLayout(compactSavedExamples(groupWikiSupplements(body,zh),zh,options.units??[])), decisions };
}

/** Restore literal payloads after a prose pass. Status/caption changes remain outside the fence. */
export function restoreWikiLiteralPayloads(before: string, after: string): string {
  if (before === after || !/[`~]{3}/u.test(before)) return after;
  const originals = wikiDocumentBlocks(before).filter(block => block.kind === "code"), changed = wikiDocumentBlocks(after).filter(block => block.kind === "code");
  if (originals.length !== changed.length) return after;
  for (let at = changed.length - 1; at >= 0; at--) if (changed[at].text !== originals[at].text) after = after.slice(0, changed[at].start) + originals[at].text + after.slice(changed[at].end);
  return after;
}

/** Per-paragraph ownership prevents a reordered chapter from pairing unrelated code blocks by position. */
export function restoreWikiChapterLiterals(before: WikiDraftChapter[], after: WikiDraftChapter[]) {
  return after.map(chapter => {
    const original = before.find(item => item.id === chapter.id);
    if (!original || original === chapter) return chapter;
    let body = chapter.body;
    const paragraphs = chapter.paragraphs.map(paragraph => {
      if (!/[`~]{3}/u.test(paragraph.text)) return paragraph;
      const key = [...paragraph.unitIds].sort().join("\u0000");
      const matching = original.paragraphs.filter(item => [...item.unitIds].sort().join("\u0000") === key && wikiDocumentBlocks(item.text).some(block => block.kind === "code"));
      if (matching.length !== 1) return paragraph;
      if (matching[0].text === paragraph.text) return paragraph;
      const text = restoreWikiLiteralPayloads(matching[0].text, paragraph.text);
      if (text === paragraph.text) return paragraph;
      const at = body.indexOf(paragraph.text); if (at >= 0) body = body.slice(0, at) + text + body.slice(at + paragraph.text.length);
      return { ...paragraph, text };
    });
    return body === chapter.body ? chapter : { ...chapter, body, paragraphs };
  });
}

/** Repair old narration injected into a source payload only when one saved original proves the exact correction. */
export function recoverWikiSourceLiterals(body: string, units: WikiKnowledgeUnit[]): string {
  const normalized = (text: string) => text.replace(/此前(?:曾)?(?:建议|采用)?|previously proposed\s*/giu, "").trimEnd();
  const originals = new Map(units.flatMap(unit => unit.evidence.code ? [[`${unit.evidence.code.language}\n${unit.evidence.code.text}`, unit.evidence.code] as const] : []));
  for (const block of wikiDocumentBlocks(body).filter(block => block.kind === "code").reverse()) {
    const open = /^\s*(`{3,}|~{3,})([^\n]*)\n/u.exec(block.text); if (!open) continue;
    const value = block.text.slice(open[0].length).replace(/\n[ \t]*(?:`{3,}|~{3,})[ \t]*$/u, "");
    const matching = [...originals.values()].filter(code => code.language === open[2].trim() && normalized(code.text) === normalized(value));
    if (matching.length !== 1 || matching[0].text === value) continue;
    const mark = "`".repeat(Math.max(2, ...(matching[0].text.match(/`+/gu) ?? []).map(run => run.length)) + 1);
    body = body.slice(0, block.start) + `${mark}${matching[0].language}\n${matching[0].text}\n${mark}` + body.slice(block.end);
  }
  return body;
}
