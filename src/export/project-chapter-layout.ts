import {wikiDocumentBlocks} from "../shared/wiki-document-blocks";
import {wikiSupplementRanges} from "../shared/wiki-source-supplements";
import {wikiHistoricalHeading} from "../shared/wiki-history-layout";

type Chapter={title:string;body:string};
const REFERENCE=/竞品|外部参考|开源参考|参考项目|\b(?:competitors?|external references?|reference projects?)\b/iu;
const PRODUCT=/^产品(?:定位|介绍|范围|概览)|^(?:product overview|product scope|product positioning)\b/iu;
const LEARNING=/学习路线|技能路线|\b(?:learning|skills?) (?:path|roadmap)\b/iu;
const DELIVERY=/里程碑|阶段|首版|MVP|\b(?:milestone|phase|release)\b/iu;
const WORK=/实现|开发|上线|冻结|暂停|重构|部署|\b(?:implement\w*|deploy\w*|ship\w*|build\w*|defer\w*)\b/iu;

function topics(body:string){
 const attachments=wikiSupplementRanges(body);
 const blocks=wikiDocumentBlocks(body).filter(block=>!attachments.some(([start,end])=>block.start>=start&&block.end<=end));
 const headings=blocks.filter(block=>block.kind==="heading"&&/^### /u.test(block.text));
 return headings.map((heading,i)=>({heading,end:headings[i+1]?.start??body.length}));
}

/** Projection of generated prose only. Keep the existing owner in scoped
 * exports unless both the named project topic and its destination are selected. */
export function organizeProjectChapterTopics(chapters:Chapter[],projectName:string,zh:boolean){
 const deliveryLabel=zh?"开发阶段与技术参考":"Delivery stages and references";
 for(const chapter of chapters){
  const blocks=wikiDocumentBlocks(chapter.body);
  const attachments=wikiSupplementRanges(chapter.body);
  for(const [index,block] of [...blocks.entries()].reverse()){
   const next=blocks[index+1];
   if(block.kind!=="heading"||next?.kind!=="heading"||block.text!==next.text||!wikiHistoricalHeading(block.text)
    ||attachments.some(([start,end])=>block.start>=start&&block.end<=end))continue;
   chapter.body=chapter.body.slice(0,block.start)+chapter.body.slice(next.start);
  }
 }
 for(const chapter of chapters)for(const {heading,end} of topics(chapter.body).reverse()){
  if(!LEARNING.test(heading.text)||chapter.body.includes(`### ${deliveryLabel}\n`))continue;
  const signals=wikiDocumentBlocks(chapter.body.slice(heading.end,end)).filter(block=>block.kind==="paragraph"&&DELIVERY.test(block.text)&&WORK.test(block.text));
  if(signals.length<2)continue;
  const all=chapter.body.slice(heading.end,end);
  if(/学习(?:课程|路径|资料)|职业规划|教程|按周学习|\b(?:career path|curriculum|study plan|tutorial)\b/iu.test(all))continue;
  chapter.body=chapter.body.slice(0,heading.start)+`### ${deliveryLabel}`+chapter.body.slice(heading.end);
 }

 const owners=chapters.filter(chapter=>PRODUCT.test(chapter.title));
 const name=projectName.normalize("NFKC").trim().toLowerCase();
 if(owners.length!==1||name.length<3)return;
 const owner=owners[0];
 for(const reference of chapters.filter(chapter=>chapter!==owner&&REFERENCE.test(chapter.title))){
  const matching=topics(reference.body).filter(({heading})=>{
   const text=heading.text.slice(4).normalize("NFKC").trim().toLowerCase();
   return text.startsWith(name)&&/^(?:产品)?(?:主链|主流程|工作流程|核心流程)$|^(?:core |main |product )?(?:workflow|journey)$/iu.test(text.slice(name.length).trim());
  });
  if(matching.length!==1||topics(reference.body).length<2)continue;
  const [{heading,end}]=matching;
  const excerpt=reference.body.slice(heading.start,end).trim();
  if(owner.body.includes(heading.text)||REFERENCE.test(excerpt.slice(heading.text.length).split(/\n\n/u)[0]))continue;
  reference.body=(reference.body.slice(0,heading.start)+reference.body.slice(end)).trimEnd();
  const history=topics(owner.body).find(({heading})=>wikiHistoricalHeading(heading.text));
  const at=history?.heading.start??owner.body.length;
  owner.body=[owner.body.slice(0,at).trimEnd(),excerpt,owner.body.slice(at)].filter(Boolean).join("\n\n");
 }
}
