import type { WikiDraftChapter } from "./wiki-knowledge";
import { paragraphIndex, removeParagraph } from "./wiki-body-text";

/** A sentence saying what a subtopic's feature is for: "冲动自救模式作为王牌功能，旨在关键时刻拉回用户……". */
const FRAMES = /^[^。！？\n]{0,24}作为[^，。]{0,10}(?:王牌|核心|关键|主打|重点|基础)(?:功能|模块|能力|卖点)|^[^。！？\n]{0,40}旨在/u;
const PROSE = (text: string) => !/^\s*(?:[-*+]|\d+\.|\||\*[^*\n]+\*\n\n|`{3,}|~{3,}|>)/u.test(text);
const FRAMING_LENGTH = 200;

/** A subtopic opening on its details and ending on what the feature is for: the reader met the three rescue steps and
 * five list items before learning that rescue is the product's main feature. The framing paragraph goes first. */
export function framingFirst(chapters: WikiDraftChapter[]): number {
  let moved = 0;
  for (const chapter of chapters) {
    const topics = [...new Set(chapter.paragraphs.map(paragraph => paragraph.subtopic))];
    for (const topic of topics) {
      const own = chapter.paragraphs.filter(paragraph => paragraph.subtopic === topic && chapter.body.includes(paragraph.text));
      if (own.length < 3 || FRAMES.test(own[0].text.trim())) continue;
      const framing = own.slice(2).reverse().find(paragraph => PROSE(paragraph.text) && paragraph.text.length <= FRAMING_LENGTH && FRAMES.test(paragraph.text.trim()));
      if (!framing) continue;
      const first = own[0], at = paragraphIndex(chapter.body, first.text);
      if (at < 0) continue;
      const body = removeParagraph(chapter.body, framing.text), place = paragraphIndex(body, first.text);
      if (place < 0) continue;
      chapter.body = `${body.slice(0, place)}${framing.text}\n\n${body.slice(place)}`;
      chapter.paragraphs.splice(chapter.paragraphs.indexOf(framing), 1);
      chapter.paragraphs.splice(chapter.paragraphs.indexOf(first), 0, framing);
      moved++;
    }
  }
  return moved;
}
