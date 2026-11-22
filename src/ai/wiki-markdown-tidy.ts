import type { WikiDraftChapter } from "../shared/wiki-knowledge";
import { replaceParagraph } from "../shared/wiki-body-text";
import { wikiDocumentBlocks } from "../shared/wiki-document-blocks";
import { repairGeneratedWikiTable } from "../shared/wiki-table-source";

/** A table written on one line, its rows joined by "||": "| 层级 | 代表项目 || --- | --- || 重量级 | PX4 |". */
const JOINED_TABLE = /^\s*\|.*\|\|\s*:?-{3,}/u;
const ITEM = /^( {0,3})(\d+)([.)])(\s+)/u;

/** The table's rows on lines of their own. Only a line that is a table with its separator row joined in. */
export function splitJoinedTable(text: string): string {
  return text.split("\n").map(line => JOINED_TABLE.test(line) ? line.trim().replace(/\|\|/gu, "|\n|") : line).join("\n");
}

/** An ordered list numbered in turn: "1. 2. 3. 5." once an item was left out reads as a missing step. A list counted
 * down, or one that does not only climb, is left as written; so is code. */
export function renumberedLists(text: string): string {
  const lines = text.split("\n");
  let fence = false;
  for (let index = 0; index < lines.length; index++) {
    if (/^\s*(`{3,}|~{3,})/u.test(lines[index])) { fence = !fence; continue; }
    if (fence || !ITEM.test(lines[index]) || index && ITEM.test(lines[index - 1])) continue;
    // One run: items at the same indent, with their indented continuation lines between them.
    const indent = lines[index].match(ITEM)![1], items: number[] = [index];
    let at = index + 1;
    for (; at < lines.length; at++) {
      const match = lines[at].match(ITEM);
      if (match && match[1] === indent) { items.push(at); continue; }
      if (!lines[at].trim() && lines[at + 1]?.match(ITEM)?.[1] === indent) continue;
      if (lines[at].trim() && /^\s{2,}\S/u.test(lines[at]) && !match) continue;
      break;
    }
    const numbers = items.map(line => Number(lines[line].match(ITEM)![2]));
    // Strip the presentation number in the item label before changing the list counter.
    items.forEach(line => { lines[line] = lines[line].replace(/^(\s*(\d{1,3})[.)]\s+(?:\*\*|__)?)(\d{1,3})[.)、][ \t]+(?=\S)/u,
      (whole, opening: string, outer: string, inner: string) => outer === inner ? opening : whole); });
    const sequence = numbers.every((number, place) => !place || number > numbers[place - 1]
      || number === 1 && numbers[place - 1] >= 3 && numbers[place + 1] === 2);
    if (sequence && numbers.some((number, place) => place && number !== numbers[place - 1] + 1))
      items.forEach((line, place) => { lines[line] = lines[line].replace(ITEM, (_, lead: string, _number: string, mark: string, gap: string) => `${lead}${numbers[0] + place}${mark}${gap}`); });
    index = at - 1;
  }
  return lines.join("\n");
}

function tidyHeadings(text: string): string {
  if (/独立研究章节|Independent research section/iu.test(text)) {
    for (const block of wikiDocumentBlocks(text).reverse()) {
      if (block.kind !== "heading") continue;
      const heading = /^(#{2,6}[ \t]+)(独立研究章节|Independent research section)[ \t]*$/iu.exec(block.text);
      if (heading) text = text.slice(0, block.start) + heading[1]
        + (/\p{Script=Han}/u.test(heading[2]) ? "外部研究与参考" : "Research and references") + text.slice(block.end);
    }
  }
  return text;
}

export function tidyGeneratedWikiMarkdown(text: string): string {
  for (const block of wikiDocumentBlocks(text).reverse()) if (block.kind === "table") {
    const repaired = repairGeneratedWikiTable(block.text);
    if (repaired !== block.text) text = text.slice(0, block.start) + repaired + text.slice(block.end);
  }
  return renumberedLists(tidyHeadings(text));
}

/** Written paragraphs as Markdown reads them: a table joined on one line split into rows, a list numbered in turn.
 * Returns the number of paragraphs changed. */
export function tidiedMarkdown(chapters: WikiDraftChapter[]): number {
  let changed = 0;
  for (const chapter of chapters) {
    const body = tidyHeadings(chapter.body);
    const titles = new Map<string, string>();
    for (const topic of chapter.paragraphs.map(paragraph => paragraph.subtopic)) {
      const heading = `### ${topic}`, title = tidyHeadings(heading);
      if (title !== heading) titles.set(topic, title.slice(4));
    }
    if (body !== chapter.body) { chapter.body = body; changed++; }
    for (const paragraph of chapter.paragraphs) paragraph.subtopic = titles.get(paragraph.subtopic) ?? paragraph.subtopic;
  }
  for (const chapter of chapters) for (const paragraph of chapter.paragraphs) {
    const text = tidyGeneratedWikiMarkdown(splitJoinedTable(paragraph.text));
    if (text === paragraph.text) continue;
    chapter.body = replaceParagraph(chapter.body, paragraph.text, text);
    if (paragraph.claims) paragraph.claims = paragraph.claims.map(claim => ({ ...claim, text: tidyGeneratedWikiMarkdown(claim.text) }));
    paragraph.text = text;
    changed++;
  }
  return changed;
}
