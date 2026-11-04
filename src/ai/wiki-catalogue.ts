import type {FocusSection} from "../shared/focus-session";

/** Directory navigation only. Full evidence stays in the writing inventory. */
export function wikiCatalogueSummary(section:FocusSection,compact=false):string {
 const marker="SOURCE DETAIL INVENTORY",at=section.body.indexOf(marker);
 // A whole routing paragraph must remain visible. Truncated leads hid a
 // secondary product near the end of an otherwise relevant-looking note.
 if(at<0)return section.body.slice(0,compact?100:1600);
 const lead=section.body.slice(0,at).trim().slice(0,compact?80:220);
 try{
  const data=JSON.parse(section.body.slice(section.body.indexOf("\n",at)+1)) as {details?:Array<Record<string,unknown>>};
  const subjects=[...new Set((data.details??[]).map(detail=>[detail.kind,detail.title??detail.text??detail.label??[detail.from,detail.to].filter(Boolean).join(" → "),detail.status].filter(value=>typeof value==="string"&&value.trim()).join(": ")))];
  return [lead,...subjects.slice(0,compact?3:6).map(subject=>subject.slice(0,compact?55:100))].filter(Boolean).join("\n").slice(0,compact?250:700);
 }catch{return lead;}
}

/** Membership needs the complete reading note, not a navigation teaser. Keep
 * every detail's subject, conditions and status, including late inventory rows.
 * Oversized notes explicitly report what was hidden; they cannot earn a complete
 * scope receipt. Originals remain in the writing inventory and source reader. */
export function wikiScopeCatalogue(section:FocusSection,limit=6000){
 const marker="SOURCE DETAIL INVENTORY",at=section.body.indexOf(marker);
 const note=(at<0?section.body:section.body.slice(0,at)).trim();
 let details:unknown[]=[],quotes:Array<{role:unknown;text:string}>=[],valid=true;
 if(at>=0)try{
  const data=JSON.parse(section.body.slice(section.body.indexOf("\n",at)+1)) as {details?:unknown[];originals?:Record<string,{role?:unknown;text?:unknown;context?:string;contextOmitted?:boolean}>};
  if(!Array.isArray(data.details))valid=false;
  else details=data.details;
  quotes=Object.values(data.originals??{}).flatMap(item=>{if(item.contextOmitted)valid=false;return typeof item.text==="string"?[{role:item.role,text:item.context??item.text}]:[];});
 }catch{valid=false;}
 // Whole rows only: never clip away a negation, condition, or status suffix.
 const kept:unknown[]=[],proof:typeof quotes=[];let size=note.length;
 for(const detail of details){const length=JSON.stringify(detail).length;if(size+length>limit)break;kept.push(detail);size+=length;}
 for(const quote of quotes){const length=JSON.stringify(quote).length;if(size+length>limit)break;proof.push(quote);size+=length;}
 const complete=valid&&note.length<=limit&&kept.length===details.length&&proof.length===quotes.length;
 return {lead:note.length<=limit?note:`${note.slice(0,limit)}\n[Reading note truncated; scope review is incomplete]`,
  ...(details.length?{scopeDetails:kept}:{}),...(quotes.length?{scopeQuotes:proof}:{}),scopeContext:{complete,omittedDetails:details.length-kept.length,omittedQuotes:quotes.length-proof.length}};
}
