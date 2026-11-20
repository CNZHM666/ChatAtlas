import { wikiDocumentBlocks } from "../shared/wiki-document-blocks";
import { isWikiTableIntroduction } from "../shared/wiki-plan-tables";

const CONFIRMATION = /(?:〔(?:用户|(?:项目)?发起人)在整理时(?:确认|标记为已定) · (C-\d+-[a-z0-9]+)〕|\[User (?:confirmed|marked as decided) during organization · (C-\d+-[a-z0-9]+)\])/gu;
const SOURCE = /\[(S-\d+-[a-z0-9]+)\](?:\((#[^)\s]+)\)|(?!\())/gu;
const SOURCE_FIRST = /(〔已定〕|\[Decided\])[ \t]+((?:\[S-\d+-[a-z0-9]+\][ \t]*)+)(〔(?:用户|(?:项目)?发起人)在整理时(?:确认|标记为已定) · C-\d+-[a-z0-9]+〕|\[User (?:confirmed|marked as decided) during organization · C-\d+-[a-z0-9]+\])/gu;

export function numberedWikiReferences(markdown: string, sources: ReadonlyMap<string, number>, confirmations: ReadonlyMap<string, number>, zh: boolean): string {
  const numbered = wikiDocumentBlocks(markdown).reverse().reduce((text, block) => {
    if (["code", "html", "definition"].includes(block.kind)||/^[\s>]*(?:`{3,}|~{3,})/mu.test(block.text)) return text;
    const revised = block.text.split(/(`+[^\n]*?`+)/gu).map((piece, index) => index % 2 ? piece : piece
      .replace(SOURCE_FIRST, (_all, status: string, refs: string, receipt: string) => `${status}${receipt} ${refs.trim()}`)
      .replace(/(〔已定〕|\[Decided\])[ \t]+(?=〔(?:用户|(?:项目)?发起人)在整理时|\[User (?:confirmed|marked as decided) during organization)/gu, "$1")
      .replace(CONFIRMATION, (all, cn: string, en: string) => {
        const id = cn ?? en, number = confirmations.get(id);
        return number === undefined ? all : `[${zh ? `〔已确认${number}〕` : `Confirmed ${number}`}](#confirmation-${id})`;
      })
      .replace(SOURCE, (all, id: string, localLink?: string) => {
        const number = sources.get(id);
        return number === undefined ? all : `[${zh ? `来源${number}` : `Source ${number}`}](${localLink ?? `#source-${id}`})`;
      })
      .replace(/^(?:原文来源|Original source|Source references?)\s+(?=\[(?:来源\d+|Source \d+)\])/gmu, ""))
      .join("");
    return revised === block.text ? text : text.slice(0, block.start) + revised + text.slice(block.end);
  }, markdown);
  const blocks = wikiDocumentBlocks(numbered);
  const sourceLine = /^(?:\[(?:来源\d+|Source \d+)\]\(#source-S-[a-z0-9-]+\)\s*)+$/u;
  return blocks.reduceRight((text, block, index) => {
    if (block.kind !== "table" || !sourceLine.test(blocks[index + 1]?.text ?? "")) return text;
    const refs: string[] = [];
    let at = index + 1;
    while (sourceLine.test(blocks[at]?.text ?? "")) {
      refs.push(...blocks[at].text.match(/\[(?:来源\d+|Source \d+)\]\(#source-S-[a-z0-9-]+\)/gu) ?? []);
      at++;
    }
    const previous = blocks[index - 1];
    const caption = previous?.kind === "paragraph" && isWikiTableIntroduction(previous.text);
    const links = [...new Set(refs)].join(" ");
    const heading = caption ? `${previous.text} ${links}` : `${zh ? "表格来源" : "Table sources"} ${links}`;
    return text.slice(0, caption ? previous.start : block.start) + heading + "\n\n" + block.text + text.slice(blocks[at - 1].end);
  }, numbered);
}
