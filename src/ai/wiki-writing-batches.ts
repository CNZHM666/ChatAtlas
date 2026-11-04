import type {CoverageMaterial,OwnedMaterial} from "./focus-coverage";
import type {DirectoryPage} from "./wiki-directory";

/** Recovery may split the first material; only its first descendant opens the
 * chapter. Other fragments must continue the prose, not restart the overview. */
export function opensWikiChapter(id:string,firstId:string|undefined):boolean {
 return firstId!==undefined&&id.startsWith(firstId)&&/^(?::1|:output-0)*$/u.test(id.slice(firstId.length));
}

/** Every writing material needs a chapter from THIS outline: a batch without one
 * has no roster to cite and fails on every retry. Writing-time source inventories
 * can add "Source detail" materials the planner never saw, and a resumed checkpoint
 * may carry them too. Route each unowned material, in order of preference, to:
 * the chapter listing it, the chapter of the material its ID extends (the same
 * prefix rule subtopics use), the chapter sharing most of its original messages,
 * else the first chapter. Valid owners are never changed. */
export function assignWikiOwners(materials:CoverageMaterial[],pages:DirectoryPage[]):OwnedMaterial[] {
 const ownerOf=(page:DirectoryPage)=>page.ownerId??page.sectionIds[0];
 const valid=new Set(pages.map(ownerOf));
 const isOwned=(item:CoverageMaterial):item is OwnedMaterial=>typeof item.wikiOwnerId==="string"&&!!item.wikiOwnerId&&valid.has(item.wikiOwnerId);
 if(materials.every(isOwned))return materials;
 if(!pages.length||pages.some(page=>!ownerOf(page)))throw new Error("Writing materials need a valid chapter outline");
 const listed=(id:string)=>pages.find(page=>page.sectionIds.includes(id)||page.subtopics?.some(topic=>topic.sectionIds.includes(id)));
 // First settle everything the outline names directly; the rest are routed against that.
 const settled=materials.map(item=>item.wikiOwnerId!==undefined&&valid.has(item.wikiOwnerId)?item:listed(item.id)?{...item,wikiOwnerId:ownerOf(listed(item.id)!)}:item);
 const owned=settled.filter(item=>item.wikiOwnerId!==undefined&&valid.has(item.wikiOwnerId));
 const byId=new Map(owned.map(item=>[item.id,item.wikiOwnerId!]));
 const extended=(id:string)=>{
  for(let cut=id.lastIndexOf(":");cut>0;cut=id.lastIndexOf(":",cut-1)){const base=id.slice(0,cut),owner=byId.get(base)??(listed(base)&&ownerOf(listed(base)!));if(owner)return owner;}
 };
 const overlapping=(item:CoverageMaterial)=>{
  const raw=new Set(item.rawEvidenceIds);let best:string|undefined,score=0;
  for(const page of pages){const owner=ownerOf(page),shared=owned.filter(other=>other.wikiOwnerId===owner).reduce((sum,other)=>sum+other.rawEvidenceIds.filter(id=>raw.has(id)).length,0);if(shared>score){best=owner;score=shared;}}
  return best;
 };
 const result=settled.map(item=>item.wikiOwnerId!==undefined&&valid.has(item.wikiOwnerId)?item:{...item,wikiOwnerId:extended(item.id)??overlapping(item)??ownerOf(pages[0])});
 if(!result.every(isOwned))throw new Error("Writing material has no chapter");
 return result;
}

/** Editorial order affects only generated notes. Original discussion order and
 * evidence identities remain unchanged in the source Reader and inventories. */
export function wikiWritingOrder(materials:OwnedMaterial[],pages:DirectoryPage[]):OwnedMaterial[][] {
 const known=new Set(materials.map(item=>item.wikiOwnerId));
 const groups=pages.flatMap(page=>{
  const owner=page.ownerId??page.sectionIds[0];known.delete(owner);
  const own=materials.filter(item=>item.wikiOwnerId===owner);
  const rank=(item:CoverageMaterial)=>{const index=page.subtopics?.findIndex(topic=>topic.sectionIds.some(id=>item.id===id||item.id.startsWith(`${id}:`)))??-1;return index<0?Number.MAX_SAFE_INTEGER:index;};
  return own.length?[own.map((item,index)=>({item,index,rank:rank(item)})).sort((a,b)=>a.rank-b.rank||a.index-b.index).map(row=>row.item)]:[];
 });
 // Unknown ownership must reach validation, never vanish during scheduling.
 for(const owner of known){const rest=materials.filter(item=>item.wikiOwnerId===owner);if(rest.length)groups.push(rest);}
 return groups;
}

/** A small completion does not need the full multi-topic output reservation.
 * Rich/code-heavy input retains the normal cap; truncation recovery stays on. */
export function wikiCompletionOutputLimit(normalLimit:number,materials:CoverageMaterial[],topicCount:number):number {
 const characters=materials.reduce((sum,item)=>sum+item.text.length,0);
 if(materials.some(item=>item.text.includes("```")))return normalLimit;
 return Math.min(normalLimit,Math.max(2400,1200+topicCount*700+Math.ceil(characters/4)));
}

/** A one-topic prose supplement can use the remaining bounded allowance. Do
 * not force rich code or several topics into a tiny last request. No extra
 * allowance is granted, and a result still needs complete coverage/citations. */
export function wikiBudgetedCompletionLimit(normalLimit:number,materials:CoverageMaterial[],topicCount:number,available:number):number {
 const desired=wikiCompletionOutputLimit(normalLimit,materials,topicCount);
 if(desired<=available)return desired;
 if(topicCount===1&&!materials.some(item=>item.text.includes("```"))&&available>=Math.min(2400,desired))return Math.min(desired,Math.floor(available));
 return desired;
}
