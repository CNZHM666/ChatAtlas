import { LEAVES_OUT } from "../shared/negation";
import { replaceParagraph, tableCells } from "../shared/wiki-body-text";
import { wikiDocumentBlocks } from "../shared/wiki-document-blocks";
import { withStop } from "../shared/wiki-sentences";
import { statesCore, wikiStatementWithConditions, type WikiDraftChapter, type WikiDraftClaim, type WikiKnowledgeUnit } from "../shared/wiki-knowledge";
import { wikiSupplementRanges } from "../shared/wiki-source-supplements";

const EDITOR_NOTE = /[（(](?:注[：:]\s*)?(?:此处)?(?:根据|按|按照)(?:上述)?(?:规则|校验(?:结果)?)(?:修正|改写|调整|删除)[^）)\n]*[）)]|[（(](?:note:\s*)?(?:rewritten|removed|omitted) (?:to satisfy|per) (?:the )?(?:validation|writing rules?)[^）)\n]*[）)]/iu;
const CUT_FLOW = /(?:->|→|=>)\s*(?:[\w.]+\s*[-=])?(?:[。.!！]\s*)?$/u;
const COMPLETE_FLOW = /(?:[\w.]+\s*(?:->|→|=>)\s*){2,}[\w.]+/gu;
const EXCLUSION = new RegExp(LEAVES_OUT, "u");
const SEQUENCE = /(?:[、，,；;]\s*(?:先(?:将|把|做|完善|完成|验证|打磨)|再(?:逐步)?|然后)|\b(?:first|then)\s)/iu;
const normalize = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[\s*。`]/gu, "");
const editorFragment = (text: string) => EDITOR_NOTE.test(text) && /…|\.{3}/u.test(text.slice(0, text.search(EDITOR_NOTE)));
const BROKEN_FLOW = /(?:->|→|=>)[^\n]{0,90}(?:[-=]|->|→|=>)[。.!！]?(?=\s*(?:$|\n)|(?<=[。.!！]))/mu;
const DANGLING_TERM = /(?:^|(?<=[。！？\n]))\s*[\p{L}\p{N}][\p{L}\p{N}._+/-]{0,25}\s*[)）][。.!?！？](?=\s|$)/u;
const DANGLING_POSSESSIVE = /(?:^|(?<=[。！？\n]))[^\S\n]*(?:\*\*)?的(?!确)[\p{Script=Han}][^。！？\n]{3,}[。！？]/u;
const DETACHED_SCOPE = /^(?:(?:第[一二三四五六七八九十\d]+(?:阶段|版)|首版|Phase\s+[A-Z\d.]+|V\d+(?:\.\d+)*)\s*)(?=的)/iu;
export const INCOMPLETE_WIKI_PROSE = "has incomplete generated prose";
export const wikiIntegrityNote = (zh: boolean) => zh
  ? "此处的生成文字不完整，请查阅对应原文。"
  : "Generated text is incomplete here. Check the original source.";
export const wikiIntegrityCandidate = (body: string) => EDITOR_NOTE.test(body) || BROKEN_FLOW.test(body)
  || DANGLING_TERM.test(body) || DANGLING_POSSESSIVE.test(body) || body.includes("|") || /\d+\s*[~～–—-]\s*\d+/u.test(body);

export function literalWikiProse(text: string, quote: string) {
  const wanted = text.trim();
  if (!DANGLING_POSSESSIVE.test(wanted)) return quote.includes(wanted);
  // The ending of a valid source sentence is not a literal dangling sentence.
  return quote.split(/(?<=[。！？])|\n/u).some(line => line.trimStart().startsWith(wanted));
}

/** Restore a stage prefix lost between drafting and rendering, using the
 * exact original sentence in this chapter rather than inferring a subject. */
export function restoreDetachedWikiScope(body: string, original: string[]): string {
  if (!DANGLING_POSSESSIVE.test(body)) return body;
  return wikiIncompleteProse(body).reverse().reduce((text, block) => {
    const tail = /^\s*(的[^。！？\n]{4,}[。！？])/u.exec(block.text)?.[1];
    if (!tail) return text;
    const matches = new Set(original.flatMap(paragraph => paragraph.split(/(?<=[。！？])|\n/u).flatMap(raw => {
      const sentence = raw.trim(), scope = DETACHED_SCOPE.exec(sentence)?.[0];
      return scope && sentence.slice(scope.length) === tail ? [scope] : [];
    })));
    if (matches.size !== 1) return text;
    const at = block.start + block.text.indexOf(tail);
    return text.slice(0, at) + [...matches][0] + text.slice(at);
  }, body);
}

/** Recover a clipped rule cell from its own cited statement. A matching action
 * with an identifier and the same explicit consequence are required. */
export function completeConditionalCell(text:string,units:WikiKnowledgeUnit[]):string|undefined {
  const parts=/^((?:返回|设置)\s*[A-Za-z_]\w*\s*[:=]\s*\w+)\s*并\s*(.+)$/u.exec(text.trim());
  if(!parts||!units.length||units.some(unit=>unit.evidence.pasted||unit.about))return;
  const compact=(value:string)=>normalize(value).replace(/[，,；;]/gu,"");
  const action=compact(parts[1]).replace(/[:=]/u,"=");
  const consequence=(value:string)=>compact(value).replace(/^(?:阻止|禁止)(?:其)?加入/u,"禁止加入");
  const expected=consequence(parts[2]);
  const statements=[...new Set(units.map(unit=>unit.statement.trim()))];
  const anchored=statements.some(statement=>/^(?:若|如果|当|一旦|仅当|疑似)/u.test(statement));
  if(!anchored||!statements.every(statement=>
    /^(?:若|如果|当|一旦|仅当|疑似)/u.test(statement)
    &&compact(statement).replace(/([a-z_]\w*)[:=](\w+)/gu,"$1=$2").includes(action)
    &&(compact(statement).endsWith(expected)||consequence(statement.split(/[，,；;]/u).at(-1)??"")===expected)))return;
  return statements.join(" ");
}

export function restoredConditionalNegation(problem:string,before:string,after:string,units:WikiKnowledgeUnit[]):boolean {
  const diagnostic=/^"(.+?)…" drops the negation of "(.+?)…"/u.exec(problem);
  return !!diagnostic&&before.startsWith(diagnostic[1])&&after.includes(diagnostic[2])
    &&completeConditionalCell(before,units)===after;
}

/** Only inspect generated prose. Literal code and quoted source material are left intact. */
export function wikiIncompleteProse(body: string) {
  if (!EDITOR_NOTE.test(body) && !BROKEN_FLOW.test(body) && !DANGLING_TERM.test(body) && !DANGLING_POSSESSIVE.test(body)) return [];
  return wikiDocumentBlocks(body).flatMap(block => {
    if (block.kind !== "paragraph" && block.kind !== "list") return [];
    const prose = block.text.replace(/`[^`\n]+`|〔[^〕\n]+〕|\[S-\d+-[a-z0-9]+\]/gu, "");
    const fragment = prose.split(/(?<=[。！？])|\n/u).find(line => BROKEN_FLOW.test(line) && CUT_FLOW.test(line)) ?? prose.match(DANGLING_TERM)?.[0] ?? prose.match(DANGLING_POSSESSIVE)?.[0];
    const note = prose.match(EDITOR_NOTE)?.[0];
    if (!note && !fragment) return [];
    const raw = block.text.split(/(?<=[。！？])|(?<=[.!?])(?=\s)|(?<=\n)/u);
    const preserved = raw.filter(sentence => !EDITOR_NOTE.test(sentence) && !DANGLING_TERM.test(sentence) && !DANGLING_POSSESSIVE.test(sentence) && !CUT_FLOW.test(sentence.replace(/〔[^〕\n]+〕|\[S-\d+-[a-z0-9]+\]/gu, "").trim())).join("").trim();
    const anchor = (fragment?.split(/->|→|=>/u)[0] ?? preserved).trim().slice(0, 30);
    return [{ ...block, preserved, problem: anchor ? `"${anchor}…" ${INCOMPLETE_WIKI_PROSE}` : INCOMPLETE_WIKI_PROSE }];
  });
}

/** The target must be named by a heading inside the quote, with the values
 * below that heading. Text above the heading may describe a different target. */
function headingTarget(text: string, unit: WikiKnowledgeUnit): string | undefined {
  const old = unit.evidence.section;
  if (!old || !text.startsWith(old + " ") || unit.statement.startsWith(old)
    || !/^#{1,6}\s/mu.test(unit.evidence.quote) || !statesCore(unit.statement, text.slice(old.length))) return;
  // Exclude identifier digits, such as the 3 in 3D.
  const quantities = (value: string) => [...value.matchAll(/(?<![\w.])\d+(?:\.\d+)?(?=px\b|%|[^\w.]|$)/giu)].map(hit => hit[0]);
  const values = quantities(unit.statement);
  if (values.length < 2 || !quantities(text).every(value => values.includes(value))) return;
  const blocks = wikiDocumentBlocks(unit.evidence.quote);
  const candidates = blocks.flatMap((block, index) => {
    if (block.kind !== "heading") return [];
    const title = block.text.replace(/^#+\s+(?:\d+[.)]\s+)?/u, "").trim();
    const end = blocks.find((next, at) => at > index && next.kind === "heading")?.start;
    const governed = unit.evidence.quote.slice(block.end, end);
    if (!title || title === old || !values.every(value => quantities(governed).includes(value))) return [];
    return [title];
  });
  if (new Set(candidates).size !== 1) return;
  return candidates[0] + text.slice(old.length);
}

function repairProse(text: string, units: WikiKnowledgeUnit[], zh: boolean): string | undefined {
  if (units.some(unit => literalWikiProse(text, unit.evidence.quote))) return;
  if (DANGLING_POSSESSIVE.test(text) && /^\s*的(?!确)/u.test(text) && units.length === 1) {
    const tail = normalize(text), unit = units[0];
    const matching = unit.statement.split(/(?<=[。！？])/u).map(sentence => sentence.trim()).find(sentence => {
      const whole = normalize(sentence);
      return whole.length > tail.length && whole.endsWith(tail);
    });
    if (matching && normalize(matching) === normalize(unit.statement)) return withStop(wikiStatementWithConditions(unit, zh));
  }
  if (EDITOR_NOTE.test(text)) {
    const note = text.match(EDITOR_NOTE)!;
    const start = note.index!;
    const left = text.slice(0, start);
    if (editorFragment(text)) {
      const cut = Math.max(left.lastIndexOf("。"), left.lastIndexOf(". "), left.lastIndexOf("！"), left.lastIndexOf("？"));
      const suffix = text.slice(start + note[0].length).trim();
      const readable = normalize(suffix);
      const suffixClause = readable.split(",").at(-1) ?? "";
      const sources = readable.length < 12 ? [] : units.filter(unit => normalize(unit.statement).includes(readable)
        || suffixClause.length >= 12 && normalize(unit.statement).endsWith(suffixClause) && statesCore(suffix, unit.statement));
      if (sources.length === 1 && units.length === 1) return left.slice(0, cut + 1) + withStop(wikiStatementWithConditions(sources[0], zh));
      return;
    }
    return left + text.slice(start + note[0].length);
  }
  if (CUT_FLOW.test(text)) {
    const start = text.search(/\b[\w.]+\s*(?:->|→|=>)/u);
    if (start >= 0) {
      const prefix = normalize(text.slice(start).replace(/[。.!！\s]+$/u, "").replace(/[-=]$/u, "")).replace(/->|=>/gu, "→");
      const chains = new Set(units.flatMap(unit => [unit.statement, unit.evidence.quote].flatMap(value => [...value.matchAll(COMPLETE_FLOW)].map(hit => hit[0])))
        .filter(chain => normalize(chain).replace(/->|=>/gu, "→").startsWith(prefix))
        .map(chain => chain.split(/\s*(?:->|=>|→)\s*/u).join(" → ")));
      if (chains.size === 1) return withStop(text.slice(0, start) + [...chains][0]);
    }
  }
  if (units.length === 1) return headingTarget(text, units[0]);
}

/** The same final pass is used for new drafts and older generated chapters.
 * Claims keep their bindings. Source blocks and personal edits are handled by
 * the caller and never reconstructed here. */
export function wikiChapterIntegrity(chapter: WikiDraftChapter, unitOf: (id: string) => WikiKnowledgeUnit | undefined, zh: boolean,
  draftClaims: readonly WikiDraftClaim[] = []) {
  let body = chapter.body, repaired = 0;
  const problems: string[] = [];
  const attachments = wikiSupplementRanges(chapter.body).map(([start,end])=>chapter.body.slice(start,end));
  const known = (ids: string[]) => ids.flatMap(id => unitOf(id) ?? []);
  const paragraphs = chapter.paragraphs.map(paragraph => {
    const original = paragraph.text;
    if(attachments.some(attachment=>attachment.includes(original)))return paragraph;
    const maybeProse = EDITOR_NOTE.test(original) || BROKEN_FLOW.test(original) || DANGLING_POSSESSIVE.test(original) || /\d/u.test(original);
    const maybeTable = original.includes("|");
    if (!maybeProse && !maybeTable) return paragraph;
    const sources = known(paragraph.unitIds);
    if (sources.some(unit => unit.evidence.code && original.includes(unit.evidence.code.text.trim()))) return paragraph;
    let text = original;
    const literal = /^\s*(?:>|`{3}|~{3})/u.test(original) || /^(?:`{3}|~{3}|>)\s*/mu.test(original)
      ? wikiDocumentBlocks(original).filter(block => block.kind === "code" || block.kind === "blockquote").map(block => block.text) : [];
    let claims: WikiDraftClaim[] = (paragraph.claims ?? []).map(claim => {
      if (!maybeProse || !claim.text || !text.includes(claim.text) || /^\s*[>`~|]/u.test(claim.text) || literal.some(block => block.includes(claim.text))) return claim;
      const bound = known(claim.unitIds);
      if (bound.length !== claim.unitIds.length) return claim;
      // A display pass can strip a stage label from a previously complete
      // sentence. Recover its exact wording and bindings from the stored draft.
      const backed = /^的(?!确)/u.test(claim.text)&&bound.length===1 ? draftClaims.filter(previous=>{
        const prefix=previous.text.slice(0,-claim.text.length);
        return previous.unitIds.length===1&&previous.unitIds[0]===bound[0].id&&previous.text.endsWith(claim.text)
          && /^(?:第[一二三四五六七八九十\d]+(?:阶段|版本?|轮)|Phase\s+\d+)\s*$/iu.test(prefix)
          && statesCore(bound[0].statement,previous.text);
      }) : [];
      const next = backed.length===1 ? backed[0].text : repairProse(claim.text, bound, zh);
      if (!next || next === claim.text) return claim;
      const followingStop = /[。.!?！？]$/u.test(next) && /[。.!?！？]/u.test(text[text.indexOf(claim.text) + claim.text.length] ?? "");
      const actual = followingStop ? next.slice(0, -1) : next;
      text = text.replace(claim.text, () => actual);
      repaired++;
      return { ...claim, text: actual };
    });
    for (const block of (maybeTable ? wikiDocumentBlocks(text).filter(block => block.kind === "table").reverse() : [])) {
      if (sources.some(unit => unit.evidence.quote.includes(block.text))) continue;
      const lines = block.text.split("\n"), header = tableCells(lines[0]);
      const restored = new Map<string,string>();
      const rendered = lines.map((line,index)=>index<2?line:line.replace(/(?<=\|)([^|]+)(?=\|)/gu,(cell:string,raw:string)=>{
        const value=raw.trim();
        const bound=claims.filter(claim=>claim.text.trim()===value);
        if(bound.length!==1)return cell;
        const units=known(bound[0].unitIds);
        if(units.length!==bound[0].unitIds.length)return cell;
        const full=completeConditionalCell(value,units);
        if(!full||/[|\n]/u.test(full))return cell;
        restored.set(value,full);
        return cell.replace(value,()=>full);
      }));
      if(restored.size){
        const next=rendered.join("\n");
        text=text.slice(0,block.start)+next+text.slice(block.end);
        claims=claims.map(claim=>restored.has(claim.text.trim())?{...claim,text:restored.get(claim.text.trim())!}:claim);
        repaired+=restored.size;
        continue;
      }
      const exclusion = header.findIndex(cell => /^(?:不做|不含|暂缓|not included|out of scope)$/iu.test(cell));
      if (exclusion < 0 || !SEQUENCE.test(block.text)) continue;
      const remove = new Map<string, string>();
      const rows = lines.slice(2).filter(line => {
        const value = tableCells(line)[exclusion];
        if (!value || !SEQUENCE.test(value)) return true;
        const bound = claims.filter(claim => value === claim.text.trim());
        const matching = [...new Set(bound.flatMap(claim => claim.unitIds))].flatMap(id => {
          const unit = unitOf(id);
          return unit && EXCLUSION.test(unit.statement) && SEQUENCE.test(unit.statement) ? [unit] : [];
        });
        if (matching.length !== 1) return true;
        remove.set(value, withStop(wikiStatementWithConditions(matching[0], zh)));
        return false;
      });
      if (!remove.size) continue;
      const table = rows.length ? lines.slice(0, 2).concat(rows).join("\n") : "";
      text = text.slice(0, block.start) + [table, ...remove.values()].filter(Boolean).join("\n\n") + text.slice(block.end);
      claims = claims.map(claim => remove.has(claim.text.trim()) ? { ...claim, text: remove.get(claim.text.trim())! } : claim);
      repaired += remove.size;
    }
    if (text !== original) body = replaceParagraph(body, original, () => text);
    return text === original ? paragraph : { ...paragraph, text, claims };
  });
  // Recheck the delivered Markdown after the repairs, including prose added
  // by local presentation passes. Code, blockquotes and inline code stay literal.
  for (const block of wikiIncompleteProse(body)) {
    if (paragraphs.some(paragraph => paragraph.text.includes(block.text) && known(paragraph.unitIds).some(unit => literalWikiProse(block.text, unit.evidence.quote)))) continue;
    problems.push(block.problem);
  }
  return { body, paragraphs, repaired, problems };
}
