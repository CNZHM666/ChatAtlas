/** Reading-only grouping. Keep original page objects, order and saved names.
 * A leading singleton joins the next group because no preceding group exists. */
export function wikiDisplayGroups<T>(pages:readonly T[],name:(page:T)=>string):Array<{name:string;pages:T[]}>{
 if(pages.length<8)return pages.length?[{name:"",pages:[...pages]}]:[];
 const runs:Array<{name:string;pages:T[]}>=[];
 for(const page of pages){const group=name(page).trim(),last=runs.at(-1);if(last?.name===group)last.pages.push(page);else runs.push({name:group,pages:[page]});}
 const merged:typeof runs=[];let leading:T[]=[];
 for(const run of runs){
  if(run.pages.length===1){if(merged.length)merged.at(-1)!.pages.push(...run.pages);else leading.push(...run.pages);continue;}
  const last=merged.at(-1);
  if(last?.name===run.name)last.pages.push(...leading,...run.pages);else merged.push({name:run.name,pages:[...leading,...run.pages]});
  leading=[];
 }
 if(leading.length)return [{name:"",pages:leading}];
 if(merged.length===1)merged[0].name="";
 return merged;
}

/** One display line; identical titles add no explanation. Stored text is intact. */
export function wikiReadingQuestion(question:string|undefined,...titles:string[]):string|undefined{
 const text=question?.trim().replace(/\s+/gu," ");
 return text&&!titles.some(title=>title.trim()===text)?text:undefined;
}
