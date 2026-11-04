import { discussionBlocks } from "../shared/discussion-context";
import { wikiQuoteRange } from "../shared/wiki-claims";

/** Literal windows and rejection signals only; lexical overlap is not semantic verification. */
const normalize = (text: string) => text.normalize("NFKC").toLowerCase();
function terms(text: string): Set<string> {
  const value = normalize(text).replace(/必须|禁止|不得|不能|应该|需要|支持|建议|用户|项目|约束|确保|进行|采用|使用|不应|不要|\b(?:must|never|should|only|not|do|use|the|a|an|to|and|or|is|are|be|with|without|project|user|constraint)\b/giu, " ");
  return new Set((value.match(/[a-z\d][a-z\d_.+-]*|[\p{Script=Han}]+/gu) ?? []).flatMap(word => /\p{Script=Han}/u.test(word)
    ? Array.from({ length: Math.max(0, word.length - 1) }, (_, index) => word.slice(index, index + 2)) : [word]));
}

function evidenceBlocks(content: string) {
  return discussionBlocks(content, Infinity).flatMap(block => {
    if (/(?:^|\n)\s*(?:```|~~~)/u.test(block.text)) return [];
    const entries = [...block.text.matchAll(/^([ \t]*)(?:[-*+] |\d+[.)、]\s+)/gmu)];
    if (!entries.length) return semanticParts(block);
    const indent = Math.min(...entries.map(entry => entry[1].length));
    const starts = [0, ...entries.filter(entry => entry[1].length === indent).map(entry => entry.index!)];
    return [...new Set(starts)].map((start, index, offsets) => {
      const end = offsets[index + 1] ?? block.text.length;
      return { start: block.start + start, end: block.start + end, text: block.text.slice(start, end) };
    }).filter(part => part.text.trim()).flatMap(semanticParts);
  });
}

/** Split only complete sentences in long prose. Conditions and qualifiers are
 * reattached below; code, decimal points and incomplete sentences stay intact. */
function semanticParts(block:{start:number;end:number;text:string}){
  if(block.text.length<=280||/```|~~~|^\s*\|/mu.test(block.text))return [block];
  const parts:Array<typeof block>=[];
  let start=0;
  for(const match of block.text.matchAll(/[。！？!?][”’"']?|\.(?=\s+[A-Z]|\s*$)|\n/gu)){
    const end=match.index!+match[0].length;
    if(block.text.slice(start,end).trim())parts.push({start:block.start+start,end:block.start+end,text:block.text.slice(start,end)});
    start=end;
  }
  if(block.text.slice(start).trim())parts.push({start:block.start+start,end:block.end,text:block.text.slice(start)});
  return parts.length?parts:[block];
}

/** Resolve a displayed proposal back to its selected option, never by ordinal
 * guessing. Ordinary confirmations retain their containing semantic window. */
export function proposalEvidence(content:string,quote:string):string {
  const range=wikiQuoteRange(content,quote);if(!range)return "";
  const options=[...content.matchAll(/(?:^|\n)\s*(?:方案\s*[一二三123ABCabc]|(?:Option|Approach)\s*[123ABCabc]|[123ABCabc][.)、])\s*[：:]?\s*/giu)];
  const at=options.findIndex((option,index)=>range.start>=option.index!&&range.end<=(options[index+1]?.index??content.length));
  if(at>=0)return content.slice(options[at].index!,options[at+1]?.index??content.length).trim();
  const windows=evidenceBlocks(content).filter(block=>block.start<range.end&&block.end>range.start);
  return windows.length?windows.map(block=>block.text.trim()).join("\n\n"):content.slice(range.start,range.end);
}

export function boundaryScope(text: string): "task" | "phase" | undefined {
  if (/本次|这次|本轮|此次|这一轮|\b(?:this (?:task|change|round|optimization)|for this task)\b/iu.test(text)) return "task";
  if (/第一版|首版|当前阶段|现阶段|暂不|暂缓|\b(?:mvp|v\d+(?:\.\d+)*|first (?:version|release)|for now|at this stage)\b/iu.test(text)) return "phase";
  return undefined;
}

export function boundaryEvidence(summary: string, content: string, quote: string): string[] {
  const range = wikiQuoteRange(content, quote);
  if (!range) return [];
  const subject = terms(summary);
  if (!subject.size) return [];
  const blocks = evidenceBlocks(content);
  const matches = blocks.flatMap((block, index) => {
    if (block.start >= range.end || block.end <= range.start || /^\s*(?:```|~~~)/u.test(block.text)) return [];
    // A statement can itself be a Markdown heading; a bare topic label is not a rule.
    if (/^\s*#{1,6}\s/u.test(block.text) && !/冻结|采用|使用|必须|禁止|不得|不做|仅|暂时|建议|\b(?:use|freeze|must|never|should|only)\b/iu.test(block.text)) return [];
    const found = terms(block.text), overlap = [...subject].filter(term => found.has(term)).length;
    const identifiers=[...subject].filter(term=>/^[a-z][a-z\d_.+-]{3,}$/u.test(term)&&found.has(term)).length;
    // Reject unrelated saved excerpts; never call a passing overlap "supported".
    return identifiers||overlap >= Math.min(2, subject.size) && overlap / subject.size >= .45 ? [{ index, overlap:overlap+identifiers*25 }] : [];
  });
  if (!matches.length) return [];
  const best = Math.max(...matches.map(match => match.overlap));
  const selected = new Set(matches.filter(match => match.overlap === best).map(match => match.index));
  for (const index of [...selected]) {
    // Keep explicit preceding conditions and the following rationale, without unrelated headings.
    if (index > 0 && (/^(?:如果|仅当|除非|对于|当|在.{0,40}时|if\b|unless\b|only when\b)/iu.test(blocks[index - 1].text.trim())||boundaryScope(blocks[index - 1].text)||/(?:我(?:的判断|认为|建议)|my (?:view|suggestion))[^\n]*[：:]\s*$/iu.test(blocks[index - 1].text))) selected.add(index - 1);
    if (index + 1 < blocks.length && /^(?:因为|因此|否则|理由[：:]|原因[：:]|但|然而|尚未|仍未|暂未|测试尚未|because\b|otherwise\b|but\b|however\b|not yet\b)/iu.test(blocks[index + 1].text.trim())) selected.add(index + 1);
  }
  return [...selected].sort((a, b) => a - b).map(index => blocks[index].text.trim());
}
