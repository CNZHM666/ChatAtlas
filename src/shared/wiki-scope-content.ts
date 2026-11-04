/** Readable routing content, never a raw internal inventory or a source teaser.
 * Conditions and code are kept whole; the UI collapses visually, not by slicing. */
export function wikiScopeContent(body:string):string{
 const at=body.indexOf("SOURCE DETAIL INVENTORY");
 if(at<0)return body.trim();
 const note=body.slice(0,at).trim();
 try{
  const data=JSON.parse(body.slice(body.indexOf("\n",at)+1)) as {originals?:Record<string,{text?:unknown;context?:string}>};
  const passages=[...new Set(Object.values(data.originals??{}).flatMap(item=>typeof item.text==="string"&&item.text.trim()?[(item.context??item.text).trim()]:[]))];
  return [note,...passages.filter(text=>!note.includes(text))].filter(Boolean).join("\n\n");
 }catch{return note;}
}
