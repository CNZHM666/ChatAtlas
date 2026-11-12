import {unified} from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { GFM_OPTIONS } from "./markdown-gfm";
import type {RootContent} from "mdast";
import {pairedWikiTitle} from "../ai/wiki-title-pass";
import {wholeKeyStatement} from "./wiki-key-claims";
import {WIKI_MIN_SUBTOPIC_CHARACTERS,wikiProseScale,wikiSubtopicBudget} from "../ai/wiki-subtopic-budget";

export const WIKI_QUALITY_TERMS=["IndexedDB","Orama","本地优先","BYOK","不得自动发送"];
const parser=unified().use(remarkParse).use(remarkGfm, GFM_OPTIONS);
const textOf=(node:RootContent):string=>"value" in node?node.value:"children" in node?node.children.map(child=>textOf(child as RootContent)).join(""):"";
const normalize=(text:string)=>text.normalize("NFKC").replace(/\s/gu,"");
const sentences=(text:string)=>text.split(/[。！？!?；;\n]|(?<!\d)\.(?=\s|$)/u).map(text=>normalize(text)).filter(Boolean);
const grams=(text:string)=>{const chars=Array.from(text);return new Set(chars.slice(2).map((_,i)=>chars.slice(i,i+3).join("")));};
const jaccard=(a:Set<string>,b:Set<string>)=>{let shared=0;for(const gram of a)if(b.has(gram))shared++;return a.size+b.size-shared?shared/(a.size+b.size-shared):0;};
const containment=(a:Set<string>,b:Set<string>)=>{let shared=0;for(const gram of a)if(b.has(gram))shared++;return Math.min(a.size,b.size)?shared/Math.min(a.size,b.size):0;};
const APPENDIX=/^(?:关键结论与来源|演变记录|本章来源|Key conclusions and sources|History|Chapter sources)$/u,KEY_CONCLUSIONS=/^(?:关键结论与来源|Key conclusions and sources)$/u;
// The source reference after a listed conclusion: 〔来源 3〕, [3], or the unresolved token.
const KEY_MARKER=/〔[^〕]*〕|\[\d+\]|SRC:[^]*/gu;
const overviewTitle=(title:string)=>/^(?:项目总览|Project overview)$/iu.test(title.trim());
const exportMetadata=/^(?:(?:本章来源(?:对话)?|Chapter sources|Chapter conversations|Source conversations for this chapter)\s*[：:]|(?:AI 提出的定价方案|原文中的 AI 定价建议|讨论中的定价方案)，具体价格待确认。|(?:Pricing proposed by AI|Pricing discussed)\. Specific prices require confirmation\.)/iu;
const exportAppendixTitle=/^(?:引用定位|Citation locators|来源索引|Source index|文档信息与核对说明|Document information and evidence notes)$/u;
const sourceCaption=/^(?:对照表|命令|数据结构|代码示例|代码|界面草图|规则逻辑|事件清单|目录结构|提示词|计算规则|示例数据|界面文案|流程|对照|清单|Table|Commands|Data structure|Code example|Code|UI sketch|Rules|Event list|File layout|Prompt|Scoring|Sample data|UI copy|Flow|Mapping|List)(?:\s*·[^\n]*)?$/iu;

/** ## chapters and ### subtopics in an exported document. Project overview is
 * measured separately, not counted as a Wiki chapter. Fenced code/quotes are not prose.
 * Ratios are 0–1; density uses non-whitespace visible prose characters. */
export function wikiQualityMetrics(markdown:string,terms:readonly string[]=WIKI_QUALITY_TERMS){
 /** subtopicProse: visible prose characters under each ### subtopic; leadParagraphs: paragraphs before the first one. */
 /** sentences: running prose only, for the duplicate checks; prose: paragraphs before the chapter's appended
  * blocks; keyItems: the chapter's listed key conclusions. */
 const chapters:Array<{title:string;subtopics:string[];paragraphs:string[];sentences:string[];subtopicProse:number[];leadParagraphs:number;appendix:false|"key"|"other";keyItems:string[];prose:string[]}>=[];
 let current:typeof chapters[number]|undefined;
 const boldLengths:number[]=[];
 const scanBold=(node:RootContent)=>{
  if(node.type==="code"||node.type==="blockquote")return;
  if(node.type==="strong")boldLengths.push(Array.from(textOf(node)).length);
  if("children" in node)for(const child of node.children)scanBold(child as RootContent);
 };
 const collect=(node:RootContent,listed=false):Array<{text:string;listed:boolean}>=>{
  if(node.type==="code"||node.type==="blockquote"||node.type==="heading"||node.type==="html")return [];
  if(node.type==="paragraph"||node.type==="tableCell")return [{text:textOf(node),listed}];
  return "children" in node?node.children.flatMap(child=>collect(child as RootContent,listed||node.type==="list")):[];
 };
 const nodes=parser.parse(markdown).children;
 for(const [position,node] of nodes.entries()){
  // Export metadata is not a knowledge chapter or a source of writing-quality counts.
  if(node.type==="heading"&&node.depth===2&&exportAppendixTitle.test(textOf(node).trim()))break;
  scanBold(node);
  if(node.type==="heading"&&node.depth===2){current={title:textOf(node).trim(),subtopics:[],paragraphs:[],sentences:[],subtopicProse:[],leadParagraphs:0,appendix:false,keyItems:[],prose:[]};chapters.push(current);continue;}
  if(!current)continue;
  if(node.type==="paragraph"){
   const label=textOf(node).trim(),next=nodes[position+1];
   if(exportMetadata.test(label)||sourceCaption.test(label)&&(next?.type==="table"||next?.type==="code"))continue;
  }
  if(node.type==="heading"&&node.depth===3){current.subtopics.push(textOf(node));current.subtopicProse.push(0);current.appendix=false;}
  // The blocks after a chapter's prose (key conclusions, history, sources) repeat its sentences by design.
  if(node.type==="paragraph"&&node.children[0]?.type==="strong"){const label=textOf(node.children[0]).trim();if(APPENDIX.test(label))current.appendix=KEY_CONCLUSIONS.test(label)?"key":"other";}
  if(current.appendix==="key"&&node.type==="list")
   current.keyItems.push(...node.children.map(item=>{const first=item.children.find(child=>child.type==="paragraph");return first?textOf(first).replace(KEY_MARKER,"").trim():"";}).filter(Boolean));
  const prose=collect(node);current.paragraphs.push(...prose.map(item=>item.text));
  // List items (key conclusions, history entries) restate the prose; only running prose counts as repeated.
  if(!current.appendix)current.prose.push(...prose.map(item=>item.text));
  if(!current.appendix&&node.type==="paragraph")current.sentences.push(...prose.filter(item=>!item.listed).flatMap(item=>sentences(item.text)));
  if(current.subtopics.length)current.subtopicProse[current.subtopicProse.length-1]+=prose.reduce((sum,item)=>sum+Array.from(normalize(item.text)).length,0);
  else if(node.type==="paragraph")current.leadParagraphs++;
 }
 const wiki=chapters.filter(chapter=>!overviewTitle(chapter.title));
 const titles=wiki.flatMap(chapter=>[chapter.title,...chapter.subtopics]);
 const sibling_suffix_pairs:Array<{first:string;second:string;suffix:string}>=[];
 for(let i=0;i<wiki.length;i++)for(let j=i+1;j<wiki.length;j++){
  const a=Array.from(normalize(wiki[i].title)),b=Array.from(normalize(wiki[j].title));let size=0;
  while(size<Math.min(a.length,b.length)&&a.at(-1-size)===b.at(-1-size))size++;
  const suffix=a.slice(a.length-size).join("");
  if(size>=(/\p{Script=Han}/u.test(suffix)?2:4)&&size<a.length&&size<b.length)sibling_suffix_pairs.push({first:wiki[i].title,second:wiki[j].title,suffix});
 }
 const entries=wiki.flatMap((chapter,index)=>[...new Set(chapter.sentences)].map(sentence=>({chapter:index,sentence,grams:grams(sentence)})));
 const cross_chapter_duplicates:Array<{first_chapter:string;second_chapter:string;first:string;second:string;similarity:number}>=[];
 // Inverted 3-gram index avoids comparing unrelated sentences quadratically.
 const index=new Map<string,number[]>();
 entries.forEach((entry,id)=>{
  const overlaps=new Map<number,number>();
  for(const gram of entry.grams)for(const other of index.get(gram)??[])if(entries[other].chapter!==entry.chapter)overlaps.set(other,(overlaps.get(other)??0)+1);
  for(const [other,intersection] of overlaps){const previous=entries[other],similarity=intersection/(entry.grams.size+previous.grams.size-intersection);
   if(similarity>=.8)cross_chapter_duplicates.push({first_chapter:wiki[previous.chapter].title,second_chapter:wiki[entry.chapter].title,first:previous.sentence,second:entry.sentence,similarity});
  }
  for(const gram of entry.grams)index.set(gram,[...index.get(gram)??[],id]);
 });
 // Repeats inside one chapter (restated positioning, a second opening) are invisible
 // to the cross-chapter check. Exact repeats count; short fragments do not.
 const intra_chapter_duplicates:Array<{chapter:string;first:string;second:string;similarity:number}>=[];
 for(const chapter of wiki){
  const seen:Array<{sentence:string;grams:Set<string>}>=[];
  for(const sentence of chapter.sentences.filter(sentence=>Array.from(sentence).length>=12)){
   const own=grams(sentence);
   const match=seen.map(previous=>({previous,similarity:jaccard(own,previous.grams)})).find(item=>item.similarity>=.8);
   if(match)intra_chapter_duplicates.push({chapter:chapter.title,first:match.previous.sentence,second:sentence,similarity:match.similarity});
   else seen.push({sentence,grams:own});
  }
 }
 const subtopicProse=wiki.flatMap(chapter=>chapter.subtopicProse),scale=wikiProseScale(wiki.flatMap(chapter=>chapter.paragraphs).join(""));
 const otherSentences=new Set(wiki.flatMap(chapter=>chapter.sentences));
 const allProse=chapters.flatMap(chapter=>chapter.paragraphs).join("\n"),characters=Array.from(normalize(allProse)).length;
 return {
  chapter_count:wiki.length,subtopic_count:wiki.reduce((sum,chapter)=>sum+chapter.subtopics.length,0),
  paired_title_rate:titles.length?titles.filter(pairedWikiTitle).length/titles.length:0,
  sibling_suffix_pairs,
  bold_count:boldLengths.length,bold_avg_chars:boldLengths.length?boldLengths.reduce((sum,size)=>sum+size,0)/boldLengths.length:0,bold_max_chars:Math.max(0,...boldLengths),
  // The document writes the holder as "AI 建议"; prose may drop the space.
  ai_advice_density:characters?(allProse.match(/AI\s*建议/gu)??[]).length*1000/characters:0,
  meta_overview_count:wiki.filter(chapter=>chapter.paragraphs[0]?.trimStart().startsWith("本章")).length,
  cross_chapter_duplicates,
  overview_verbatim_overlap:chapters.filter(chapter=>overviewTitle(chapter.title)).flatMap(chapter=>chapter.sentences).filter(sentence=>otherSentences.has(sentence)).length,
  intra_chapter_duplicates,
  // Wire citation IDs that survived presentation (<e2>, [e2], 【e2】), outside code.
  raw_citation_markers:(markdown.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1/gmu,"").replace(/(`+)[^`\n]*?\1/gu,"").match(/<\/?e\d+(?::\d+)?>|\[\^?e\d+(?::\d+)?\]|【e\d+(?::\d+)?】/giu)??[]).length,
  // "建议发现了…" style sentences: a proposal verb left without its actor.
  // Listed key conclusions are counted too when they are a clause without its subject
  // ("用于保存所有历史对话及消息") or the tail of a longer sentence of the chapter.
  orphan_advice_subjects:(allProse.match(/(?:^|[。！？\n])\s*建议(?=发现|起草|提出|生成|指出|认为|评估|对[^。！？\n]{0,60}(?:进行|评估)|[^。！？\n]{0,8}了)/gu)??[]).length
   +wiki.reduce((sum,chapter)=>{const body=chapter.prose.join("\n");return sum+chapter.keyItems.filter(item=>!wholeKeyStatement(item,body)).length;},0),
  // A chapter whose first two paragraphs restate each other (opening plus a second summary).
  // Containment, not Jaccard: the second summary is usually a longer paraphrase of the first.
  // Paraphrased second summaries share few 3-grams, so two or more paragraphs
  // stacked before the first subtopic also count as a double opening.
  double_openings:wiki.filter(chapter=>chapter.subtopics.length>0&&chapter.leadParagraphs>1||chapter.paragraphs.length>1&&containment(grams(normalize(chapter.paragraphs[0])),grams(normalize(chapter.paragraphs[1])))>=.45).length,
  // Fragmentation: explanation per subtopic, subsections too thin to stand alone,
  // and chapters with more subtopics than their prose supports.
  subtopic_avg_chars:subtopicProse.length?subtopicProse.reduce((sum,size)=>sum+size,0)/subtopicProse.length:0,
  short_subtopics:subtopicProse.filter(size=>size<WIKI_MIN_SUBTOPIC_CHARACTERS*scale).length,
  over_budget_chapters:wiki.filter(chapter=>chapter.subtopics.length>1&&chapter.subtopics.length>Math.max(1,wikiSubtopicBudget(chapter.subtopicProse.reduce((sum,size)=>sum+size,0),scale))).length,
  repeated_terms:terms.map(term=>{const needle=term.toLocaleLowerCase();const counts=wiki.map(chapter=>chapter.paragraphs.join("\n").toLocaleLowerCase().split(needle).length-1);return {term,chapters:counts.filter(count=>count>0).length,occurrences:counts.reduce((sum,count)=>sum+count,0)};}),
 };
}

/** CSV deliberately includes counts only; sentence/title examples stay in the
 * explicitly requested local Markdown report. Never persist these projections. */
export function wikiQualityCsvMetrics(markdown:string){
 const {sibling_suffix_pairs,cross_chapter_duplicates,intra_chapter_duplicates,repeated_terms,...metrics}=wikiQualityMetrics(markdown);
 return {...metrics,sibling_suffix_pairs:sibling_suffix_pairs.length,cross_chapter_duplicates:cross_chapter_duplicates.length,intra_chapter_duplicates:intra_chapter_duplicates.length,repeated_terms:JSON.stringify(repeated_terms)};
}
export const WIKI_QUALITY_CSV_COLUMNS=["chapter_count","subtopic_count","paired_title_rate","sibling_suffix_pairs","bold_count","bold_avg_chars","bold_max_chars","ai_advice_density","meta_overview_count","cross_chapter_duplicates","overview_verbatim_overlap","repeated_terms","intra_chapter_duplicates","raw_citation_markers","orphan_advice_subjects","double_openings","subtopic_avg_chars","short_subtopics","over_budget_chapters"] as const;
