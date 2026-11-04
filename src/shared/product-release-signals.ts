const releasePattern = "(?:v\\d+(?:\\.\\d+)*(?:\\s*(?:alpha|beta|rc)\\s*\\d*)?|(?:alpha|beta|rc)(?:\\s*\\d+)?|milestone\\s*\\d+|M\\d+)";
const signal = new RegExp(`\\b${releasePattern}\\b|里程碑\\s*\\d+|第[一二三四五六七八九十百\\d]+版`, "giu");
export const productReleaseLabelPattern = `${releasePattern}|里程碑\\s*\\d+|第[一二三四五六七八九十百\\d]+版`;
const label = new RegExp(`^(?:${productReleaseLabelPattern})$`, "iu");
export const isProductReleaseLabel = (value: string) => label.test(value.trim());
/** A locator only. The model and original-proof review still decide product relevance. */
export function productReleaseMentions(text:string){
  const matches:Array<{index:number;label:string}>=[];let offset=0,fence="";
  for(const line of text.split("\n")){
    const code=line.trim().match(/^(`{3,}|~{3,})/u)?.[1][0];
    if(code){fence=fence===code?"":fence||code;offset+=line.length+1;continue;}
    if(!fence)for(const match of line.matchAll(signal)){
      const prefix=line.slice(0,match.index).trim();
      const dependency=/(?:依赖|安装|npm\s|package|dependency|upgrade|升级\s*(?:React|Node|Python|Orama)|(?:React|Node(?:\.js)?|Python|Orama|TypeScript|PostgreSQL|SQLite|ONNX)\s*(?:版本|version)?\s*)$/iu.test(prefix);
      if(!dependency)matches.push({index:offset+match.index!,label:match[0]});
    }
    offset+=line.length+1;
  }
  return matches;
}
