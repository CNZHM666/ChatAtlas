import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { GFM_OPTIONS } from "./markdown-gfm";

const parser = unified().use(remarkParse).use(remarkGfm, GFM_OPTIONS);
const cache = new Map<string, string>();
interface TextNode { type: string; value?: string; children?: TextNode[]; position?: { start: {offset?:number}; end: {offset?:number} } }
const visibleText = (node: TextNode): string => node.type === "html" ? "" : node.value ?? (node.children ?? []).map(visibleText).join("");

/** Match the Markdown renderer, retaining underscores and punctuation inside code. */
export function sourceQuoteText(value: string): string {
  const cached = cache.get(value);
  if (cached !== undefined) return cached;
  const text = visibleText(parser.parse(value) as TextNode);
  cache.set(value, text);
  if (cache.size > 64) cache.delete(cache.keys().next().value!);
  return text;
}

export interface SourceQuoteProjection { text: string; starts: number[]; ends: number[] }
const projections = new Map<string, SourceQuoteProjection | null>();

/** Project a complete Markdown block onto visible characters. Never parse a
 * truncated prefix: it may end inside emphasis, an entity or a code fence. */
export function sourceQuoteProjection(value: string): SourceQuoteProjection | undefined {
  if (projections.has(value)) return projections.get(value) ?? undefined;
  const result: SourceQuoteProjection = {text:"", starts:[], ends:[]};
  let valid = true;
  const append = (text:string, start:number, end:number, into:SourceQuoteProjection) => {
    for (const char of text) for (const part of char.normalize("NFKC")) if (!/\s/u.test(part)) {
      into.text += part;
      for (let i=0;i<part.length;i++) { into.starts.push(start); into.ends.push(end); }
    }
  };
  const visit = (node:TextNode, quotes=0) => {
    if (node.type === "html") return;
    if (node.children) { for (const child of node.children) visit(child, quotes + Number(node.type === "blockquote")); return; }
    if (!node.value) return;
    const start=node.position?.start.offset, end=node.position?.end.offset;
    if (start===undefined || end===undefined) { valid=false; return; }
    let chars=Array.from(value.slice(start,end).matchAll(/[\s\S]/gu),match=>({char:match[0],start:start+match.index,end:start+match.index+match[0].length}));
    // MDAST omits structural quote prefixes from values but keeps them in offsets.
    if (quotes) {
      let lineStart=false, depth=0;
      chars=chars.filter(item=>{
        if (item.char === "\n") { lineStart=true; depth=0; return true; }
        if (!lineStart) return true;
        if (/^[ \t]$/u.test(item.char)) return false;
        if (item.char === ">" && depth<quotes) { depth++; return false; }
        lineStart=false; return true;
      });
    }
    if (node.type === "code") {
      const raw=chars.map(item=>item.char).join("");
      const opening=/^[ \t]*(`{3,}|~{3,})[^\n]*(?:\n|$)/u.exec(raw);
      if (opening) {
        chars=chars.slice(Array.from(opening[0]).length);
        const body=chars.map(item=>item.char).join("");
        const closing=new RegExp(`(?:^|\\n)[ \\t]*${opening[1][0]}{${opening[1].length},}[ \\t]*$`,"u").exec(body);
        if (closing) chars=chars.slice(0,Array.from(body.slice(0,closing.index)).length);
      }
    } else if (node.type === "inlineCode") {
      const fence=/^`+/u.exec(chars.map(item=>item.char).join(""))?.[0].length ?? 0;
      chars=chars.slice(fence,chars.length-fence);
    }
    const projected:SourceQuoteProjection={text:"",starts:[],ends:[]};
    for (let i=0;i<chars.length;i++) {
      const item=chars[i];
      if (node.type === "text" && item.char === "\\" && /^[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]$/u.test(chars[i+1]?.char ?? "")) {
        const next=chars[++i]; append(next.char,item.start,next.end,projected);
      } else if (node.type === "text" && item.char === "&") {
        const entity=/^&(?:#[xX][\da-fA-F]+|#\d+|[a-zA-Z][a-zA-Z\d]+);/u.exec(chars.slice(i,i+40).map(char=>char.char).join(""))?.[0];
        if (entity) {
          const decoded=sourceQuoteText(entity);
          if (decoded !== entity) { append(decoded,item.start,chars[i+entity.length-1].end,projected); i+=entity.length-1; continue; }
        }
        append(item.char,item.start,item.end,projected);
      } else append(item.char,item.start,item.end,projected);
    }
    if (projected.text !== node.value.normalize("NFKC").replace(/\s/gu,"")) { valid=false; return; }
    result.text+=projected.text;
    for(let i=0;i<projected.starts.length;i++){result.starts.push(projected.starts[i]);result.ends.push(projected.ends[i]);}
  };
  visit(parser.parse(value) as TextNode);
  // Unknown transformations (math/widgets, for example) must fail closed.
  const projection=valid && result.text===sourceQuoteText(value).normalize("NFKC").replace(/\s/gu,"") ? result : undefined;
  if (value.length<100_000) {
    projections.set(value,projection??null);
    if (projections.size>16) projections.delete(projections.keys().next().value!);
  }
  return projection;
}
