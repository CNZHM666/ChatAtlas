/** Conservative, lossless layout choices for plain source material. No inference or model calls. */
export type PlainBlockKind = "table" | "flow" | "list" | "groups" | "terms" | "progress";
export interface PlainBlockLayout { kind: PlainBlockKind; markdown: string }
export const wikiLiteralText = (text: string) => text.replace(/([\\`*_{}[\]<>#|])/gu, "\\$1");
const linesOf = (text: string) => text.split(/\r?\n/u).map(line=>line.trim()).filter(Boolean);
const ARROW = /^(?:↓|→|->|=>|⬇)$/u;
const BULLET = /^(?:[-*+]\s+|\d+[.)]\s+)/u;
const valueText = (value: string) => /^#[\da-f]{3,8}(?:\s*\/\s*#[\da-f]{3,8})*$/iu.test(value) ? "`"+value+"`" : wikiLiteralText(value);
const table = (pairs: Array<[string,string]>, zh: boolean) => [zh?"| 项目 | 内容 |":"| Item | Value |","| --- | --- |",...pairs.map(([key,value])=>`| ${wikiLiteralText(key)} | ${valueText(value)} |`)].join("\n");

export function plainBlockLayout(text: string, zh=true): PlainBlockLayout | undefined {
 const lines=linesOf(text);
 if(lines.length<2||lines.length>30)return;
 // Standalone arrows establish an order, not a checklist. A regular paragraph
 // wraps at spaces on narrow screens without forcing a row for every label.
 if(lines.some(line=>ARROW.test(line))){
  if(lines.length%2===1&&lines.every((line,at)=>at%2
   ?line===lines[1]
   :!/[↓→⬇\u2500-\u257F]|->|=>/u.test(line)&&!BULLET.test(line)&&line.length<=90))
   return {kind:"flow",markdown:lines.filter((_,at)=>at%2===0).map(wikiLiteralText).join(" → ")};
  return;
 }
 if(lines.some(line=>/[┌└├┤│┃{}]|^\s*(?:interface |export |const |function )/u.test(line)))return;
 if(lines.every(line=>/^Step\s+\d+\s*\/\s*\d+$/iu.test(line)))return {kind:"progress",markdown:(zh?"进度文案示例：":"Progress copy examples: ")+lines.map(line=>"`"+line+"`").join(" · ")};
 // A colon is explicit evidence of a key/value relationship.
 const inline=lines.map(line=>/^([^：:]{1,50})[：:]\s+(.+)$/u.exec(line));
 if(inline.every(Boolean))return {kind:"table",markdown:table(inline.map(match=>[match![1],match![2]]),zh)};
 const pairs:Array<[string,string]>=[];
 if(lines.length%2===0)for(let at=0;at<lines.length;at+=2){
  const key=lines[at],value=lines[at+1];
  if(!/[:：]$/u.test(key)&&!/^(?:负责|用于|用来|职责[：:]|responsible for\b|handles?\b)/iu.test(value))break;
  pairs.push([key.replace(/[:：]$/u,""),value]);
 }
 if(pairs.length*2===lines.length)return {kind:"table",markdown:table(pairs,zh)};
 // Preserve blank-separated groups before considering any flattening.
 const groups=text.trim().split(/\r?\n\s*\r?\n/u).map(group=>linesOf(group));
 if(groups.length>1){
  // Repeated category/value pairs are a compact mapping, not five tiny sections.
  if(groups.every(group=>group.length===2&&/[:：]$/u.test(group[0])&&group[0].length<=45&&group[1].length<=80&&!/[→↓]|->/u.test(group[1])))
   return {kind:"table",markdown:table(groups.map(group=>[group[0],group[1].replace(BULLET,"")]),zh)};
  if(groups.every(group=>group.length>=2&&/[:：]$/u.test(group[0])&&group[0].length<=45&&group.slice(1).every(line=>line.length<=80&&!/[→↓]|->/u.test(line))))
   return {kind:"groups",markdown:groups.map(group=>`**${wikiLiteralText(group[0])}**\n\n${group.slice(1).map(line=>BULLET.test(line)?line:`- ${wikiLiteralText(line)}`).join("\n")}`).join("\n\n")};
  return;
 }
 // A palette gives its own field/value boundary. All rows must have one; no generic word-pair guessing.
 if(lines.filter(line=>/#[\da-f]{3,8}\b/iu.test(line)).length>=2){
  const colors=lines.map(line=>/^(.+?)\s+(#[\da-f]{3,8}\b.*)$/iu.exec(line)??/^(.+?)\s{2,}(.+)$/u.exec(line)??/^([A-Za-z][A-Za-z ]{0,35})\s+([\p{Script=Han}].+)$/u.exec(line));
  if(colors.every(Boolean))return {kind:"table",markdown:table(colors.map(match=>[match![1],match![2].trim()]),zh)};
 }
 if(lines.length<=16&&lines.every(line=>/^(?:Add|Run|Fit|Toggle|Generate|Open|Close|Save|Delete|Create|Edit|Copy|Import|Export|添加|运行|切换|保存|删除|打开|关闭|生成|导入|导出)\s*[^。.!?！？]{1,45}$/iu.test(line)))
  return {kind:"terms",markdown:lines.map(wikiLiteralText).join(" · ")};
 if(lines.every(line=>BULLET.test(line)))return {kind:"list",markdown:lines.join("\n")};
 // Shortness does not establish parallelism: inventory titles, logical operators,
 // directory paths and field names must retain their original example context.
}
