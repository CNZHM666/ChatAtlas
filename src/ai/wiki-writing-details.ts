import type {ProjectState} from "../shared/project-state";
import type {CoverageMaterial} from "./focus-coverage";
import {wikiQuoteRange} from "../shared/wiki-claims";
import {unified} from "unified";
import remarkParse from "remark-parse";
import {sourceMessageSignature} from "../shared/source-signature";
import {wikiProofContext} from "../shared/wiki-proof-context";
const noteParser=unified().use(remarkParse);

/** Lossless routing candidates from generated notes, never new Wiki pages.
 * Whole Markdown paragraphs can be reviewed separately; lists, quoted evidence,
 * code and incomplete lead-ins stay together. Raw messages are never split. */
export function wikiWritingUnits(notes:CoverageMaterial[]):CoverageMaterial[]{
 return notes.flatMap(note=>{
  if(note.role||note.text.includes("SOURCE DETAIL INVENTORY"))return [note];
  const nodes=noteParser.parse(note.text).children;
  const headings=nodes.filter(node=>node.type==="heading");
  const boundaries=[0,...nodes.flatMap((node,index)=>{
   const previous=nodes[index-1];
   if(node.type==="heading"){
    const start=node.position!.start.offset!;
    // notesFromResult prefixes its title as plain text. Do not turn that
    // navigation label into an empty new material before the first heading.
    if(node===headings[0]&&note.text.slice(0,start).trim()===note.title.trim())return [];
    return [start];
   }
   // A paragraph followed by a list/code/quote is its introduction, not a
   // separate scope. Never use sentence slicing or product-name heuristics.
   if(node.type==="paragraph"&&previous?.type==="paragraph"&&/[。.!?！？]\s*$/u.test(note.text.slice(previous.position!.start.offset!,previous.position!.end.offset!)))return [node.position!.start.offset!];
   return [];
  }).filter(offset=>offset>0),note.text.length];
  if(boundaries.length===2)return [note];
  return boundaries.slice(0,-1).flatMap((start,index)=>{
   const text=note.text.slice(start,boundaries[index+1]);if(!text.trim())return [];
   const path:typeof headings=[];
   for(const heading of headings.filter(heading=>heading.position!.start.offset!<=start)){while(path.length&&path.at(-1)!.depth>=heading.depth)path.pop();path.push(heading);}
   const title=path.length?path.map(heading=>note.text.slice(heading.position!.start.offset!,heading.position!.end.offset!).replace(/^#{1,6}\s+/u,"").trim()).join(" / "):note.title;
   return [{...note,id:`${note.id}:topic${index}`,title,text}];
  });
 });
}

type Proof={quote?:string;evidenceIds?:string[]};

/** Decode only our retained inventories. JSON escaping is not evidence loss. */
export function wikiNoteEvidenceText(notes:Array<Pick<CoverageMaterial,"text">>):string {
 return notes.map(note=>{
  const marker="\n\nSOURCE DETAIL INVENTORY (evidence for prose/claims, not separate chapters or adoption proof):\n",at=note.text.indexOf(marker);
  if(at<0)return note.text;
  try{
   const data=JSON.parse(note.text.slice(at+marker.length)) as {originals?:Record<string,{text?:unknown}>};
   return note.text.slice(0,at)+"\n"+Object.values(data.originals??{}).flatMap(item=>typeof item.text==="string"?[item.text]:[]).join("\n");
  }catch{return note.text.slice(0,at);}
 }).join("\n");
}

/** Enrich owned notes. Ambiguous details are grouped by literal proof for
 * routing, never promoted into chapters. Originals are deduplicated evidence. */
export function enrichWikiWritingNotes(notes:CoverageMaterial[],facts:ProjectState|undefined,batch:CoverageMaterial[]):CoverageMaterial[] {
 return buildWikiWritingNotes(notes,facts,batch,true);
}

/** The catalogue owns material identity and persisted scope keys. After fact
 * projection, refresh evidence inside those materials without inventing IDs. */
export function refreshWikiWritingNotes(notes:CoverageMaterial[],facts:ProjectState|undefined,batch:CoverageMaterial[]):CoverageMaterial[] {
 return buildWikiWritingNotes(notes,facts,batch,false);
}

function buildWikiWritingNotes(notes:CoverageMaterial[],facts:ProjectState|undefined,batch:CoverageMaterial[],createMaterials:boolean):CoverageMaterial[] {
 if(!facts||!notes.length)return notes;
 // Refresh our own evidence inventory, preserving the source-note prose.
 notes=notes.map(note=>({...note,text:note.text.split("\n\nSOURCE DETAIL INVENTORY (evidence for prose/claims, not separate chapters or adoption proof):\n")[0]}));
 const rows:Array<{value:object;proofs:Proof[]}>=[];
 for(const item of facts.modules)rows.push({value:{kind:"module",title:item.title,purpose:item.purpose,inputs:item.inputs,outputs:item.outputs,status:item.status},proofs:[item]});
 for(const item of facts.relations){const from=facts.modules.find(module=>module.id===item.from)?.title??item.from,to=facts.modules.find(module=>module.id===item.to)?.title??item.to;rows.push({value:{kind:item.kind,from,to,label:item.label},proofs:[item]});}
 for(const kind of ["decisions","constraints","questions"] as const)for(const item of facts[kind]??[])rows.push({value:{kind,text:item.text,reason:item.reason,status:item.status},proofs:[item]});
 for(const item of facts.history??[])rows.push({value:{kind:"current_change",title:item.title,after:item.after,reason:item.reason,status:item.status,decisionStatus:item.decisionStatus,workStatus:item.workStatus},proofs:[item,{quote:item.reasonQuote,evidenceIds:item.reasonEvidenceIds},{quote:item.confirmationQuote,evidenceIds:item.confirmationEvidenceIds},{quote:item.workQuote,evidenceIds:item.workEvidenceIds},...item.additions??[],...item.modifications??[]]});
 const inventories=notes.map(()=>({details:[] as unknown[],originals:new Map<string,{role:string;text:string;sourceIds:string[]}>(),seen:new Set<string>()}));
 for(const row of rows){
  const originals=row.proofs.flatMap(proof=>(proof.evidenceIds??[]).flatMap(id=>{
   const source=batch.find(item=>item.id===id),range=source&&proof.quote&&wikiQuoteRange(source.text,proof.quote);
   const context=source&&proof.quote?wikiProofContext(source.text.replace(/^(user|assistant|system|tool): /u,""),proof.quote):{};
   return source&&range?[{role:source.role??source.text.match(/^(user|assistant|system|tool): /u)?.[1]??"unknown",text:source.text.slice(range.start,range.end).replace(/^(user|assistant|system|tool): /u,""),...(context.text?{context:context.text}:{}),...(context.omitted?{contextOmitted:true}:{}),sourceIds:source.rawEvidenceIds}]:[];
  }));
  if(!originals.length)continue;
  const support=new Set(originals.flatMap(original=>original.sourceIds));
  const scores=notes.map(note=>note.rawEvidenceIds.filter(id=>support.has(id)).length);
  const best=Math.max(...scores);if(!best)continue;
  const candidates=scores.flatMap((score,index)=>score===best?[index]:[]);
  // Shared message provenance is not semantic ownership. Resolve a tie only
  // with a literal proof in exactly one candidate; never choose the first.
  const literal=candidates.filter(index=>row.proofs.some(proof=>proof.quote&&wikiQuoteRange(notes[index].text,proof.quote)));
  // Even one note can share a message with an unrelated product. Provenance
  // alone must not absorb that product's facts into the note's inventory.
  let owner=literal.length===1?literal[0]:undefined;
  if(owner===undefined){
   // Keep grounded but unassigned details as an explicit routing candidate,
   // deduplicated by proof. Do not silently lose them or guess a project owner.
   const id=`${notes[0].id.split(":proof:")[0]}:proof:${sourceMessageSignature(JSON.stringify(originals))}`;
   owner=notes.findIndex(note=>note.id===id);
   if(owner<0&&!createMaterials){
    // Retain new literal support inside an already planned material. Prefer a
    // Source detail candidate over assigning an ambiguous fact to named prose.
    owner=candidates.find(index=>notes[index].id.includes(":proof:"))??candidates[0];
   }
   if(owner<0){owner=notes.length;notes.push({...notes[candidates[0]],id,title:"来源补充 / Source detail",text:originals.map(original=>original.text).join("\n\n"),rawEvidenceIds:[...support]});inventories.push({details:[],originals:new Map(),seen:new Set()});}
  }
  const inventory=inventories[owner],keys:string[]=[];
  for(const original of originals){const signature=JSON.stringify(original);let key=[...inventory.originals].find(([,value])=>JSON.stringify(value)===signature)?.[0];if(!key){key=`quote${inventory.originals.size+1}`;inventory.originals.set(key,original);}if(!keys.includes(key))keys.push(key);}
  const detail={...row.value,quoteKeys:keys},key=JSON.stringify(detail);
  if(!inventory.seen.has(key)){inventory.seen.add(key);inventory.details.push(detail);}
 }
 return notes.map((note,index)=>{const inventory=inventories[index];return inventory.details.length?{...note,text:note.text+"\n\nSOURCE DETAIL INVENTORY (evidence for prose/claims, not separate chapters or adoption proof):\n"+JSON.stringify({details:inventory.details,originals:Object.fromEntries(inventory.originals)})}:note;});
}
