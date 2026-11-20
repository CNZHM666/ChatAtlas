import { personalDirection, statesCore, type WikiDraftChapter, type WikiDraftClaim, type WikiKnowledgeOrganization, type WikiKnowledgeUnit } from "../shared/wiki-knowledge";
import { replaceParagraph } from "../shared/wiki-body-text";
import { wikiHistoricalHeading } from "../shared/wiki-history-layout";
import { knowledgeOverlap } from "../shared/knowledge-subject";
import { wikiUnitLane } from "./wiki-unit-routing";
import { recognitionImplementation, RECOGNITION_TOPIC, SIMULATION_UI, WORKSPACE_PANEL } from "../shared/wiki-feature-reading";

/** A paragraph none of whose units belongs to its chapter, most of them to another: one run wrote the light and dark
 * palettes and the type scale under 核心工作流 / 库存管理与采购辅助 while their subjects sat in the UI chapter, which then
 * said nothing of colours. The paragraph goes to that chapter, under the subtopic of its first unit's subject there.
 * home: unit id → the subject it is written under. Returns how many paragraphs moved. */
const MOVE_SHARE = .5, MIN_UNITS = 2;
export function rehomedStrayParagraphs(chapters: WikiDraftChapter[], organization: Pick<WikiKnowledgeOrganization, "chapters">, home: ReadonlyMap<string, string>, units?: ReadonlyMap<string, WikiKnowledgeUnit>): number {
  const placeOf = new Map<string, Place | undefined>();
  for (const chapter of organization.chapters) for (const topic of chapter.subtopics) for (const id of topic.subjectIds) {
    // Imported or older layouts may repeat a subject under several headings.
    // Those bindings cannot identify which heading owns a paragraph.
    const place = placeOf.get(id);
    const unique = !placeOf.has(id) || place?.chapter === chapter.id && place.subtopic === topic.title;
    placeOf.set(id, unique && !wikiHistoricalHeading(topic.title) ? { chapter: chapter.id, subtopic: topic.title } : undefined);
  }
  const placeOfUnit = (id: string) => { const subject = home.get(id); return subject ? placeOf.get(subject) : undefined; };
  let moved = 0;
  for (const chapter of chapters) {
    // The chapter the paragraph before went to: a one-unit paragraph right after it ("Dark Mode需独立优化……" after the
    // palettes) goes along when its unit's subject is there too.
    let follow: string | undefined;
    for (const paragraph of [...chapter.paragraphs]) {
      const places = paragraph.unitIds.flatMap(id => placeOfUnit(id) ?? []);
      if (wikiHistoricalHeading(paragraph.subtopic)) continue;
      // Moving prose with an unplaced claim can separate it from its evidence
      // or from an existing section-wide condition.
      if (places.length !== paragraph.unitIds.length || !chapter.body.includes(paragraph.text)) continue;
      const [unitId] = paragraph.unitIds;
      const bound = paragraph.unitIds.length === 1 && !paragraph.claims?.some(claim =>
        claim.unitIds.some(id => id !== unitId));
      const unit = bound ? units?.get(unitId) : undefined;
      const ownScope = unit && (statesCore(unit.statement, paragraph.text) && statesCore(paragraph.text, unit.statement)
        || wikiUnitLane(unit) === "interface" && statesCore(paragraph.text, unit.statement));
      const solePlace = places.length === 1 && paragraph.unitIds.length === 1 && ownScope ? places[0] : undefined;
      const target = solePlace && solePlace.chapter !== chapter.id ? solePlace.chapter : destination(places, chapter.id, follow);
      follow = target;
      const local = places[0]?.chapter === chapter.id && places[0].subtopic !== paragraph.subtopic
        && (places.length >= MIN_UNITS || solePlace) && places.length === paragraph.unitIds.length
        && places.every(place => place.chapter === chapter.id && place.subtopic === places[0].subtopic)
        && (Boolean(solePlace && unit && ["security","procurement","interface"].includes(wikiUnitLane(unit) ?? ""))
          || chapter.paragraphs.some(other => other !== paragraph && other.subtopic === places[0].subtopic));
      const into = local ? chapter : target ? chapters.find(other => other.id === target) : undefined;
      if (!into) { follow = undefined; continue; }
      const subtopic = local ? places[0].subtopic : places.find(place => place.chapter === target)!.subtopic;
      // Out of its chapter, with a heading left with nothing under it.
      chapter.paragraphs = chapter.paragraphs.filter(other => other !== paragraph);
      chapter.body = replaceParagraph(chapter.body, paragraph.text, "").replace(/\n{3,}/gu, "\n\n").replace(/(### [^\n]+)\n+(?=### |$)/gu, "").trim();
      // Reuse the closest existing explanation in this topic when there is
      // one; otherwise retain the topic's existing order.
      const peers = into.paragraphs.filter(other => other.subtopic === subtopic);
      const nearest = solePlace && !/^[|>#`~*-]|\n/u.test(paragraph.text)
        ? peers.filter(other => !/^[|>#`~*-]|\n/u.test(other.text)).map(other => ({ other, overlap: knowledgeOverlap(paragraph.text, other.text).length }))
          .filter(item => item.overlap >= 4).sort((a, b) => b.overlap - a.overlap)[0]?.other : undefined;
      const last = nearest ?? peers.at(-1);
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
  return moved + rehomedListItems(chapters, placeOfUnit) + (units
    ? rehomePersonalAdvice(chapters, organization, units) + rehomeFeatureDetails(chapters, organization) : 0);
}

type Place = { chapter: string; subtopic: string };

function rehomeFeatureDetails(chapters: WikiDraftChapter[], organization: Pick<WikiKnowledgeOrganization, "chapters">) {
  const candidates = organization.chapters.flatMap(chapter => chapter.subtopics.map(topic => ({chapter:chapter.id,subtopic:topic.title})));
  const unique = (places:Place[]) => places.length === 1 ? places[0] : undefined;
  const feature = unique(candidates.filter(place => RECOGNITION_TOPIC.test(place.subtopic)
    && /库存|零件|导入|inventory|import/iu.test(place.subtopic) && !/\bV\d/iu.test(place.subtopic)));
  if (!feature) return 0;
  const panel = unique(candidates.filter(place => /工作区布局|工作区界面|workspace layout/iu.test(place.subtopic)));
  const simulation = unique(candidates.filter(place => /仿真|simulation/iu.test(place.subtopic) && !RECOGNITION_TOPIC.test(place.subtopic)));
  const responsibility = unique(candidates.filter(place => /^(?:AI\s*执行(?:引擎|链路)|系统(?:职责|模块分工)|AI execution(?: engine)?|System responsibilities)$/iu.test(place.subtopic)));
  let moved = 0;
  for (const chapter of chapters) for (const paragraph of [...chapter.paragraphs]) {
    if (!RECOGNITION_TOPIC.test(paragraph.subtopic) || wikiHistoricalHeading(paragraph.subtopic) || !paragraph.unitIds.length) continue;
    const literal = paragraph.text.match(/^\*[^\n]+\*\n\n`{3}(?:text)?\n([\s\S]+?)\n`{3}$/u)?.[1];
    const standalone = !/^[>#|`~]/u.test(paragraph.text) && !/`{3}|~{3}|^\*讨论中的原文/mu.test(paragraph.text);
    const assignments = literal?.split(/\n\s*\n/u);
    const crossModule = assignments && assignments.length >= 3 && assignments.every(row =>
      /^[\w .+/-]{2,45}\n(?:负责|handles? |owns? )[^\n]+$/iu.test(row.trim()))
      && !RECOGNITION_TOPIC.test(literal!);
    const destination = crossModule ? responsibility : !standalone ? undefined
      : WORKSPACE_PANEL.test(paragraph.text) ? panel : SIMULATION_UI.test(paragraph.text) ? simulation ?? panel
      : recognitionImplementation(paragraph.text) ? feature : undefined;
    const target = destination && chapters.find(item => item.id === destination.chapter);
    if (!target || target === chapter || !chapter.body.includes(paragraph.text)
      || chapter.body.indexOf(paragraph.text) !== chapter.body.lastIndexOf(paragraph.text)) continue;
    const heading = "### " + destination!.subtopic;
    const start = target.body.indexOf(heading + "\n");
    if (start < 0) continue;
    const first = target.paragraphs.find(item => item.subtopic === destination!.subtopic && target.body.includes(item.text));
    const scope = destination === feature && /(?:^|\n)\s*\d+\. \*\*[^\n]*(?:识别范围|recognition scope)/iu.test(paragraph.text);
    const following = target.body.slice(start + heading.length).search(/^###\s/mu);
    const end = following < 0 ? target.body.length : start + heading.length + following;
    const at = scope && first ? target.body.indexOf(first.text) : end;
    if (!target.body.includes(paragraph.text)) {
      target.body = target.body.slice(0, at).trimEnd() + "\n\n" + paragraph.text + (at < target.body.length ? "\n\n" + target.body.slice(at) : "");
      target.paragraphs.push({...paragraph,subtopic:destination!.subtopic});
    }
    chapter.body = replaceParagraph(chapter.body, paragraph.text, "").replace(/\n{3,}/gu,"\n\n");
    chapter.paragraphs = chapter.paragraphs.filter(item => item !== paragraph);
    moved++;
  }
  return moved;
}

/** Source wording can identify career advice even when extraction filed its
 * technical example as project architecture. Only move the bound sentence. */
function rehomePersonalAdvice(chapters: WikiDraftChapter[], organization: Pick<WikiKnowledgeOrganization, "chapters">,
  units: ReadonlyMap<string, WikiKnowledgeUnit>) {
  const homes = organization.chapters.flatMap(chapter => chapter.subtopics
    .filter(topic => /个人(?:技术)?成长|职业规划|个人发展|^(?:Personal (?:development|technical direction)|Career development)$/iu.test(topic.title))
    .map(topic => ({ id: chapter.id, title: topic.title })));
  if (homes.length !== 1) return 0;
  const [home] = homes, target = chapters.find(chapter => chapter.id === home.id);
  if (!target) return 0;
  let moved = 0;
  for (const chapter of chapters) {
    if (chapter === target) continue;
    for (const paragraph of chapter.paragraphs) {
      if (wikiHistoricalHeading(paragraph.subtopic) || /^[|>#`~*-]|\n/u.test(paragraph.text) || !chapter.body.includes(paragraph.text)) continue;
      const candidates = paragraph.claims?.filter(claim => {
        const unit = claim.unitIds.length === 1 && units.get(claim.unitIds[0]);
        if (!unit || unit.about || unit.evidence.role !== "assistant" || unit.evidence.pasted
          || !/^(?:[\s\S]{0,220})(?:你最适合的是|你的(?:个人|长期)(?:技术|职业)?方向|you should pursue|your (?:career|personal technical) direction)/iu.test(unit.evidence.quote)) return false;
        return (personalDirection(unit.evidence.quote) || /(?:该|这个)方向|career direction/iu.test(unit.evidence.quote))
          && paragraph.text.includes(claim.text) && /[。.!?]$/u.test(claim.text)
          && !paragraph.claims?.some(other => other !== claim && other.text.includes(claim.text));
      }) ?? [];
      if (!candidates.length) continue;
      const original = paragraph.text;
      for (const claim of candidates) {
        const text = (/\p{Script=Han}/u.test(home.title) ? "个人技术方向的讨论建议：" : "Personal technical advice: ") + claim.text;
        if (!target.body.includes(text)) {
          const heading = "### " + home.title;
          const at = target.body.indexOf(heading + "\n");
          target.body = at < 0 ? target.body + "\n\n" + heading + "\n\n" + text
            : target.body.slice(0, at + heading.length) + "\n\n" + text + target.body.slice(at + heading.length);
          target.paragraphs.push({ text, subtopic: home.title, unitIds: claim.unitIds, claims: [{ ...claim, text }] });
        }
        paragraph.text = paragraph.text.replace(claim.text, "").trim();
        paragraph.claims = paragraph.claims?.filter(item => item !== claim);
        paragraph.unitIds = paragraph.unitIds.filter(id => !claim.unitIds.includes(id) || paragraph.claims?.some(item => item.unitIds.includes(id)));
        moved++;
      }
      chapter.body = replaceParagraph(chapter.body, original, paragraph.text);
    }
    chapter.paragraphs = chapter.paragraphs.filter(paragraph => paragraph.text);
  }
  return moved;
}

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
