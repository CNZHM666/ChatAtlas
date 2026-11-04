import type {FocusSession,FocusScope,WikiScopeReview} from "./focus-session";

export interface WikiMembershipChoice {includeKeys:string[];excludeKeys:string[];ignoredKeys?:string[]}

/** Apply an editorial choice locally only when it cannot change generated
 * prose. Restoring omitted material or excluding retained prose needs a preview. */
export function applyWikiMembership(session:FocusSession,choice:WikiMembershipChoice):FocusSession|undefined{
 const review=session.wikiScopeReview;if(!review)return;
 const ignored=new Set(choice.ignoredKeys??[]),excluded=new Set([...choice.excludeKeys,...ignored]);
 const included=new Set(choice.includeKeys.filter(key=>!excluded.has(key)));
 const before=new Set(review.excludeKeys??[]);
 const retained=new Set(session.sections.flatMap(section=>section.wikiMaterialKeys??[]));
 for(const item of review.unreviewed??[])retained.add(item.key);
 for(const item of review.materials)if(item.kind!=="other"&&!item.userExcluded)for(const key of item.keys??[item.key])retained.add(key);
 if([...excluded].some(key=>!before.has(key)&&retained.has(key)))return;
 if([...included].some(key=>before.has(key)||review.materials.some(item=>(item.keys??[item.key]).includes(key)&&item.kind!=="reference")))return;
 const unreviewed=review.unreviewed?.filter(item=>!included.has(item.key)&&!excluded.has(item.key));
 return {...session,updatedAt:Date.now(),wikiScopeReview:{...review,includeKeys:[...included],excludeKeys:[...excluded],ignoredKeys:[...ignored],
  status:review.unreviewed?.length&&!unreviewed?.length?"complete":review.status,unreviewed,
  materials:review.materials.map(item=>(item.keys??[item.key]).every(key=>excluded.has(key))?{...item,userExcluded:true}:item)}};
}

/** Incremental updates replace routing only for the source messages they read.
 * A short direct patch has no routing receipt, so it must not erase other topics. */
export function mergeWikiScopeReview(previous:FocusSession,patch:FocusSession,scope:FocusScope,removedKeys:string[],full:boolean,remap:Map<string,string>):WikiScopeReview|undefined{
 const old=previous.wikiScopeReview,fresh=patch.wikiScopeReview;
 if(!old&&!fresh)return;
 const touched=new Set([...removedKeys,...(scope.blocks??[]).flatMap(block=>block.messageIds.map(id=>JSON.stringify([block.conversationId,id])))]);
 const retained=full?[]:(old?.materials??[]).filter(item=>item.evidenceIds.every(id=>{const ref=previous.evidence.find(ref=>ref.id===id);return ref&&!touched.has(JSON.stringify([ref.conversationId,ref.messageId]));}));
 const latest=(fresh?.materials??[]).map(item=>({...item,evidenceIds:item.evidenceIds.map(id=>remap.get(id)??id)}));
 const materials=[...new Map([...retained,...latest].map(item=>[item.key,item])).values()];
 const unchecked=full?[]:(old?.unreviewed??[]).filter(item=>item.evidenceIds.every(id=>{const ref=previous.evidence.find(ref=>ref.id===id);return ref&&!touched.has(JSON.stringify([ref.conversationId,ref.messageId]));}));
 const unreviewed=[...new Map([...unchecked,...(fresh?.unreviewed??[]).map(item=>({...item,evidenceIds:item.evidenceIds.map(id=>remap.get(id)??id)}))].map(item=>[item.key,item])).values()];
 // The latest run carries the user's current exclusions; an exclusion wins over an older inclusion.
 const ignored=new Set(fresh?fresh.ignoredKeys??[]:old?.ignoredKeys??[]);
 const excluded=new Set([...(fresh?fresh.excludeKeys??[]:old?.excludeKeys??[]),...ignored]);
 const status=full?fresh?.status:fresh?.status==="complete"&&old?.status==="complete"?"complete":"incomplete";
 return {version:1,...(status?{status}:{}),goal:patch.goal,includeKeys:[...new Set([...old?.includeKeys??[],...fresh?.includeKeys??[]])].filter(key=>!excluded.has(key)),...(excluded.size?{excludeKeys:[...excluded]}:{}),...(ignored.size?{ignoredKeys:[...ignored]}:{}),...(unreviewed.length?{unreviewed:unreviewed.filter(item=>!excluded.has(item.key))}:{}),materials};
}

/** A flagged material is already outside the Wiki, so declining it needs no
 * re-planning: it only becomes a recorded exclusion that later updates keep. */
export function excludeWikiMaterial(session:FocusSession,key:string):FocusSession{
 const review=session.wikiScopeReview,material=review?.materials.find(item=>item.key===key);
 if(!review||!material||material.userExcluded||material.kind!=="other")return session;
 const keys=material.keys??[material.key];
 return {...session,updatedAt:Date.now(),wikiScopeReview:{...review,includeKeys:review.includeKeys.filter(item=>!keys.includes(item)),excludeKeys:[...new Set([...review.excludeKeys??[],...keys])],
  materials:review.materials.map(item=>item.key===key?{...item,userExcluded:true as const}:item)}};
}

/** The reader leaves one generated chapter out before saving. Nothing is
 * regenerated: the chapter leaves this version, and its notes' keys join the
 * exclusions, so later updates keep it out until "纳入 Wiki" brings it back. */
export function excludeWikiChapter(session:FocusSession,chapterId:string,zh:boolean):FocusSession{
 const chapter=session.sections.find(section=>section.id===chapterId),keys=chapter?.wikiMaterialKeys??[];
 if(!chapter||!keys.length||chapter.userEdited||chapter.origin)return session;
 const review:WikiScopeReview=session.wikiScopeReview??{version:1,goal:session.goal,includeKeys:[],materials:[]};
 const sections=session.sections.filter(section=>section.id!==chapterId);
 return {...session,sections,activeSectionId:session.activeSectionId===chapterId?sections[0]?.id??"":session.activeSectionId,updatedAt:Date.now(),
  wikiScopeReview:{...review,includeKeys:review.includeKeys.filter(key=>!keys.includes(key)),excludeKeys:[...new Set([...review.excludeKeys??[],...keys])],
   ...(review.unreviewed?{unreviewed:review.unreviewed.filter(item=>!keys.includes(item.key))}:{}),
   materials:[...review.materials,{id:chapter.id,key:keys[0],keys,title:chapter.title,body:"",evidenceIds:chapter.evidenceIds.slice(0,3),kind:"other",reason:zh?"你在预览中选择不保留这一章":"You left this chapter out in the preview",quote:"",userExcluded:true}]}};
}
