import { withoutPlatformCitations } from "./conversation-text";
const ids = String.raw`e\d+(?::\d+)?(?:\s*(?:[,，、;；+]|[-–—至]|\s)\s*e?\d+(?::\d+)?)*`;
const label = String.raw`(?:证据(?:来源|编号|索引|\s*IDs?)?|引用来源|参考来源|来源依据|原文依据|来源|引用|索引|参见|参考|sources?|evidence(?:\s*(?:sources?|Ids?))?|references?|refs?|citations?|see)`;
const formattedLabel=String.raw`(?:\*\*|__)?${label}(?:\*\*|__)?`;
// Models sometimes wrap wire IDs as pseudo tags (<e2>, <e1><e17>); no real HTML element is named e<digits>.
const marker = new RegExp(String.raw`(?:<\/?\s*${ids}\s*>|\[\^?\s*(?:${formattedLabel}\s*[:：]?\s*(?:\*\*|__)?)?${ids}\s*\](?!\s*[:(])|【\s*(?:${formattedLabel}\s*[:：]?\s*(?:\*\*|__)?)?${ids}\s*】|[（(]\s*(?:${formattedLabel}\s*[:：]?\s*(?:\*\*|__)?)?${ids}\s*[）)]|(?:${formattedLabel})\s*[:：]\s*(?:\*\*|__)?\s*${ids}(?![\w-])(?:\*\*|__)?)`, "giu");
// Range references are wire metadata too, including a missing opening bracket.
const range = String.raw`\[?\s*e\d+:\d+\s*\]\s*[-–—至]\s*\[\s*e\d+:\d+\s*\]`;
const proofRanges = new RegExp(String.raw`${range}(?:\s*[,，、;；]\s*${range})*(?!\s*[:(])`, "giu");
const annotations = new RegExp(`(?:${proofRanges.source}|${marker.source})`, "giu");

/** Hide wire citation annotations in generated prose, retaining real source links and technical notation. */
export function evidencePresentation(content: string): string {
  content = withoutPlatformCitations(content);
  let fence = "", mathBlock = false;
  const lists:Array<{indent:number;content:number}>=[];
  const definitions = new Set([...content.matchAll(/^ {0,3}\[([^\]\n]+)\]:/gmu)].map(match => match[1].toLowerCase()));
  const removeMarkers = (text: string) => {
    // A private sentinel retains the provenance of removed citation separators.
    const removed="\uE000ATLAS_REMOVED_CITATION\uE001";
    const stripped=text.replace(annotations, match => {
    const keys = [...match.matchAll(/e\d+:\d+/giu)].map(item => item[0].toLowerCase());
    return keys.some(key => definitions.has(key)) || definitions.has(match.slice(1, -1).trim().toLowerCase()) ? match : removed;
    });
    const token=removed.replace(/[.*+?^${}()|[\]\\]/gu,"\\$&");
    return stripped
      // Consume a now-empty outer wrapper only when we just removed a known
      // wire citation. A pre-existing [] may be a genuine array or source text.
      .replace(new RegExp(`\\[[ \\t]*${token}[ \\t]*\\](?![ \\t]*[:(\\[])`,"gu"),removed)
      .replace(new RegExp(`${token}(?:[ \\t]*[,，、;；][ \\t]*${token})*`,"gu"),removed)
      .replace(new RegExp(`[ \\t]*${token}[ \\t]*[,，、;；](?=[ \\t]*[。.!！?？]|[ \\t]*$)`,"gu"),"")
      .replace(new RegExp(`[ \\t]+${token}(?=[,，、;；。.!！?？]|$)`,"gu"),"")
      .replace(new RegExp(`[,，、;；][ \t]*${token}(?=[ \t]*[。.!！?？]|[ \t]*$)`,"gu"),"")
      .replaceAll(removed,"")
      // Old saved drafts may already have lost their citation IDs. Repair only
      // impossible trailing separators in unprotected prose, never code or math.
      .replace(/[,，、;；](?:[ \t]*[,，、;；])*[ \t]*(?=[。.!！?？])/gu,"")
      .replace(/[ \t]+(?=[。！？])/gu,"");
  };
  const lines=content.split("\n");
  return lines.map((line,index) => {
    // Four spaces can mean a nested list paragraph, not just literal code.
    // Track list content indentation; code still needs four extra spaces.
    const indent=line.match(/^[ \t]*/u)![0].replace(/\t/gu,"    ").length;
    if(!fence&&line.trim()){
      while(lists.length&&indent<lists[lists.length-1].content)lists.pop();
      const item=line.match(/^([ \t]*)(?:[-+*]|\d{1,9}[.)])([ \t]+)(?=\S)/u);
      const parent=lists[lists.length-1];
      if(item&&(indent<4||parent&&indent<parent.content+4))lists.push({indent,content:indent+item[0].trimStart().length});
    }
    const list=lists[lists.length-1],codeIndent=list?list.content+4:4;
    const delimiter = indent<codeIndent?line.trimStart().match(/^(`{3,}|~{3,})/u)?.[1]:undefined;
    if (delimiter) { if (!fence) fence = delimiter; else if (delimiter[0] === fence[0] && delimiter.length >= fence.length) fence = ""; return line; }
    if (fence || indent>=codeIndent) return line;
    if (line.trim() === "$$") { mathBlock = !mathBlock; return line; }
    if (mathBlock) return line;
    // Citation-only bullets may bold the label, separating it from its colon.
    // Remove only a complete wire-ID list, never a named source or real data.
    const metadata=line.replace(/^\s*(?:>\s*)+/u, "").replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/u, "").replace(/\*\*|__/gu, "").trim();
    if(new RegExp(`^${label}\\s*[:：]\\s*${ids}[\\s。.;；]*$`,"iu").test(metadata))return "";
    // Code, math, URLs and actual Markdown links are not citation annotations.
    const protectedText = /(`+)[\s\S]*?\1|\$\$[^\n]*?\$\$|\$[^$\n]+\$|!?\[[^\]\n]*\]\([^\n)]*\)|!?\[[^\]\n]*\]\[[^\]\n]*\]|https?:\/\/[^\s<>]+/gu;
    let output = "", start = 0;
    for (const match of line.matchAll(protectedText)) {
      const reference = match[0].match(/^!?\[([^\]]+)\]\[([^\]]*)\]$/u);
      const annotationPair = reference && new RegExp(`^${ids}$`, "iu").test(reference[1]) && new RegExp(`^${ids}$`, "iu").test(reference[2]) && !definitions.has(reference[2].toLowerCase());
      output += removeMarkers(line.slice(start, match.index)) + (annotationPair ? removeMarkers(match[0]) : match[0]);
      start = match.index! + match[0].length;
    }
    output += removeMarkers(line.slice(start));
    // A generated citation-only line can become "引用来源：，，，" after
    // hiding wire IDs. Remove that empty wrapper, never a real named/link source.
    const wrapper = output.replace(/^\s*(?:>\s*)+/u, "").replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/u, "").replace(/\*\*|__/gu, "").trim();
    const punctuation = String.raw`[\s,，、;；:：.。…·()（）\[\]【】—–-]*`;
    if (new RegExp(String.raw`^(?:引用来源|参考来源|证据来源|来源依据|原文依据|来源|引用|参考|证据|sources?|references?|citations?|evidence)\s*[:：]${punctuation}$`, "iu").test(wrapper)) {
      // A label on its own line may introduce a genuine excerpt on the next
      // quoted line. Keep that original quote together instead of dropping its label.
      if(/^\s*>/u.test(line)){
        const following:string[]=[];
        for(let next=index+1;next<lines.length&&/^\s*>/u.test(lines[next]);next++)following.push(lines[next].replace(/^\s*(?:>\s*)+/u,""));
        if(following.some(value=>!new RegExp(`^${punctuation}$`,"u").test(removeMarkers(value).replace(/\*\*|__/gu,"").trim())))return output;
      }
      return "";
    }
    if (output !== line && new RegExp(`^${punctuation}$`, "u").test(wrapper)) return "";
    return output;
  }).join("\n");
}
