import type { WikiDraftChapter, WikiDraftClaim, WikiKnowledgeOrganization } from "../shared/wiki-knowledge";
import { replaceParagraph } from "../shared/wiki-body-text";

/** A paragraph none of whose units belongs to its chapter, most of them to another: one run wrote the light and dark
 * palettes and the type scale under 核心工作流 / 库存管理与采购辅助 while their subjects sat in the UI chapter, which then
 * said nothing of colours. The paragraph goes to that chapter, under the subtopic of its first unit's subject there.
 * home: unit id → the subject it is written under. Returns how many paragraphs moved. */
const MOVE_SHARE = .5, MIN_UNITS = 2;
export function rehomedStrayParagraphs(chapters: WikiDraftChapter[], organization: Pick<WikiKnowledgeOrganization, "chapters">, home: Map<string, string>): number {
  const placeOf = new Map(organization.chapters.flatMap(chapter => chapter.subtopics.flatMap(topic => topic.subjectIds.map(id => [id, { chapter: chapter.id, subtopic: topic.title }] as const))));
  const placeOfUnit = (id: string) => { const subject = home.get(id); return subject ? placeOf.get(subject) : undefined; };
  let moved = 0;
  for (const chapter of chapters) {
    // The chapter the paragraph before went to: a one-unit paragraph right after it ("Dark Mode需独立优化……" after the
    // palettes) goes along when its unit's subject is there too.
    let follow: string | undefined;
    for (const paragraph of [...chapter.paragraphs]) {
      const places = paragraph.unitIds.flatMap(id => placeOfUnit(id) ?? []);
      const target = destination(places, chapter.id, follow);
      follow = target;
      const into = target ? chapters.find(other => other.id === target) : undefined;
      if (!into) { follow = undefined; continue; }
      const subtopic = places.find(place => place.chapter === target)!.subtopic;
      // Out of its chapter, with a heading left with nothing under it.
      chapter.paragraphs = chapter.paragraphs.filter(other => other !== paragraph);
      chapter.body = replaceParagraph(chapter.body, paragraph.text, "").replace(/\n{3,}/gu, "\n\n").replace(/(### [^\n]+)\n+(?=### |$)/gu, "").trim();
      // Into the other, after the last paragraph of that subtopic, or under a heading of its own at the end.
      const last = [...into.paragraphs].reverse().find(other => other.subtopic === subtopic);
      const placed = { ...paragraph, subtopic };
      if (last && into.body.includes(last.text)) {
        into.body = replaceParagraph(into.body, last.text, `${last.text}\n\n${paragraph.text}`);
        into.paragraphs.splice(into.paragraphs.indexOf(last) + 1, 0, placed);
      } else {
        into.body = `${into.body.trim()}\n\n### ${subtopic}\n\n${paragraph.text}`;
        into.paragraphs.push(placed);
      }
      moved++;
    }
  }
  return moved + rehomedListItems(chapters, placeOfUnit);
}

type Place = { chapter: string; subtopic: string };

/** A list item none of whose units (two or more) belongs to its chapter, most of them to another: "界面布局：主屏仅保留左侧
 * 元件库、中间 Canvas、右侧当前上下文" sat in 技术架构's list beside an item of its own. The item goes as a list of its own. */
function rehomedListItems(chapters: WikiDraftChapter[], placeOfUnit: (id: string) => Place | undefined): number {
  let moved = 0;
  for (const chapter of chapters) for (const paragraph of [...chapter.paragraphs]) {
    const lines = paragraph.text.split("\n");
    if (lines.length < 2 || !lines.every(line => /^\s*(?:[-*+]|\d+\.)\s/u.test(line)) || !paragraph.claims?.length) continue;
    for (const line of lines) {
      const claims: WikiDraftClaim[] = paragraph.claims ?? [];
      const own = claims.filter(claim => line.includes(claim.text.trim()));
      const places: Place[] = own.flatMap(claim => claim.unitIds.flatMap(id => placeOfUnit(id) ?? []));
      const target = places.length >= MIN_UNITS ? destination(places, chapter.id, undefined) : undefined;
      const into = target ? chapters.find(other => other.id === target) : undefined;
      if (!into || paragraph.text.split("\n").length < 2) continue;
      const ids = new Set(own.flatMap(claim => claim.unitIds));
      const before = paragraph.text;
      paragraph.text = paragraph.text.split("\n").filter(other => other !== line).join("\n");
      paragraph.claims = claims.filter(claim => !own.includes(claim));
      // A unit another item still cites stays cited here too.
      const left = new Set(paragraph.claims.flatMap(claim => claim.unitIds));
      paragraph.unitIds = paragraph.unitIds.filter(id => !ids.has(id) || left.has(id));
      chapter.body = replaceParagraph(chapter.body, before, paragraph.text);
      const item = line.replace(/^\s*\d+\.\s/u, "- ");
      const subtopic = places.find(place => place.chapter === target)!.subtopic;
      const placed = { subtopic, text: item, unitIds: [...ids], claims: own.map(claim => ({ ...claim })) };
      const last = [...into.paragraphs].reverse().find(other => other.subtopic === subtopic);
      if (last && into.body.includes(last.text)) {
        into.body = replaceParagraph(into.body, last.text, `${last.text}\n\n${item}`);
        into.paragraphs.splice(into.paragraphs.indexOf(last) + 1, 0, placed);
      } else {
        into.body = `${into.body.trim()}\n\n### ${subtopic}\n\n${item}`;
        into.paragraphs.push(placed);
      }
      moved++;
    }
  }
  return moved;
}

/** Where a paragraph whose units sit at these places belongs, when not in its own chapter. */
function destination(places: Array<{ chapter: string }>, own: string, follow: string | undefined): string | undefined {
  if (!places.length || places.some(place => place.chapter === own)) return undefined;
  // One unit is too little to tell alone: a subject the organizer filled loosely (MVP 范围 under UI 视觉风格) would carry
  // it off. Beside a paragraph that moved there, it tells.
  if (places.length < MIN_UNITS) return places[0].chapter === follow ? follow : undefined;
  const counts = new Map<string, number>();
  for (const place of places) counts.set(place.chapter, (counts.get(place.chapter) ?? 0) + 1);
  const [target, count] = [...counts].sort((a, b) => b[1] - a[1])[0];
  return count / places.length > MOVE_SHARE ? target : undefined;
}

/** Subtopic headings with nothing under them ("### Current Status" right before "### Launch Plan"), their paragraphs
 * moved or dropped by the passes after writing. Returns how many chapters lost one. */
export function droppedEmptyHeadings(chapters: WikiDraftChapter[]): number {
  let dropped = 0;
  for (const chapter of chapters) {
    const emptied = chapter.body.replace(/^### [^\n]*\n(?:[ \t]*\n)*(?=### |\s*(?![\s\S]))/gmu, "").trimEnd();
    if (emptied !== chapter.body.trimEnd()) { chapter.body = emptied; dropped++; }
  }
  return dropped;
}
