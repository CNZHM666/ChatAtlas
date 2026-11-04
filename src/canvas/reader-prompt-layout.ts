/** Display-only normalization for decorative prompt banners. Saved material,
 * equations, fenced code and indented code remain unchanged. */
export function readerPromptLayout(source:string):string {
 let fence:{char:string;length:number}|undefined;
 return source.split(/\r?\n/u).map(line=>{
  const marker=line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/u);
  if(fence){if(marker&&marker[1][0]===fence.char&&marker[1].length>=fence.length&&!marker[2].trim())fence=undefined;return line;}
  if(marker){fence={char:marker[1][0],length:marker[1].length};return line;}
  if(/^ {0,3}={5,}\s*$/u.test(line))return "\n---\n";
  const banner=line.match(/^ {0,3}={5,}\s*([^=\s].*?)(?:\s*={5,})?\s*$/u);
  return banner?`\n### ${banner[1]}\n`:line;
 }).join("\n");
}
