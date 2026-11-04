import type { FocusSection } from "../shared/focus-session";
import { readingTitle } from "../shared/reading-title";
import { reviewLead } from "./review-presentation";
import { semanticChapterSteps } from "../shared/semantic-structure";
import { structureIsCurrent, type StructureSources } from "../shared/structure-signature";

/** Plain paragraphs and labelled list items are steps too; code stays intact. */
function bodySteps(section: FocusSection): FocusSection[] {
  const blocks: string[] = [];
  let current: string[] = [], fence = "";
  const flush = () => { const body = current.join("\n").trim(); if (body) blocks.push(body); current = []; };
  for (const line of section.body.split("\n")) {
    const marker = line.trim().match(/^(`{3,}|~{3,})/u)?.[1];
    if (marker) { if (!fence) fence = marker[0]; else if (marker[0] === fence) fence = ""; current.push(line); continue; }
    if (!fence && (!line.trim() || /^\s*(?:[-*+] |\d+[.)、] )/u.test(line))) flush();
    current.push(line);
  }
  flush();
  if (blocks.length === 1 && !/```|~~~/u.test(blocks[0])) {
    const sentences = [...new Intl.Segmenter(undefined, { granularity: "sentence" }).segment(blocks[0])].map(item => item.segment);
    if (sentences.length > 2) {
      const width = Math.ceil(sentences.length / 6);
      blocks.splice(0, 1, ...Array.from({ length: Math.ceil(sentences.length / width) }, (_, index) => sentences.slice(index * width, (index + 1) * width).join("")));
    }
  }
  const size = Math.max(1, Math.ceil(blocks.length / 8));
  return Array.from({ length: Math.ceil(blocks.length / size) }, (_, index) => {
    const body = blocks.slice(index * size, (index + 1) * size).join("\n\n");
    const label = body.match(/^\s*(?:[-*+]\s+|\d+[.)、]\s+)?\*\*(.+?)\*\*/u)?.[1];
    return { id: `chapter-step:${section.id}:body-${index}`, title: label || reviewLead(body) || section.title, body, transition: "", evidenceIds: [...section.evidenceIds], kind: section.kind };
  });
}

/** Derive local reading steps from actual headings, preserving their hierarchy and text. */
function derivedSteps(section: FocusSection): FocusSection[] {
  const lines = section.body.split("\n");
  let fence = "";
  const parents: Array<{ depth: number; title: string; inline: boolean }> = [];
  const headings: Array<{ title: string; start: number; depth: number; parent: string; lead?: string }> = [];
  lines.forEach((line, start) => {
    const marker = line.trim().match(/^(`{3,}|~{3,})/u)?.[1];
    if (marker) { if (!fence) fence = marker[0]; else if (marker[0] === fence) fence = ""; return; }
    if (fence) return;
    const match = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/u);
    const label = !match ? line.match(/^\s*(?:[-*+]\s+|\d+[.)、]\s+)?\*\*([^*\n]{1,100})\*\*\s*[:：]?\s*(.*)$/u) : undefined;
    if (!match && !label) return;
    const depth = match ? match[1].length : ([...parents].reverse().find(item => !item.inline)?.depth ?? 1) + 1;
    const title = (match ? match[2] : label![1]).replace(/[*_`]/gu, "").replace(/[:：]$/u, "").trim();
    if (depth === 1 && title === section.title) return;
    while (parents.length && parents[parents.length - 1].depth >= depth) parents.pop();
    headings.push({ title, start, depth, parent: parents.at(-1)?.title ?? "", lead: label?.[2] });
    parents.push({ depth, title, inline: Boolean(label) });
  });
  if (!headings.length || headings.length === 1 && headings[0].title === section.title) {
    const steps = bodySteps(section);
    return section.origin === "user" && steps.length <= 1 ? [] : steps;
  }
  const prelude = lines.slice(0, headings[0].start).join("\n").trim();
  const intro = reviewLead(prelude) ? bodySteps({ ...section, body: prelude }) : [];
  return [...intro, ...headings.map((heading, index) => ({ id: `chapter-step:${section.id}:${index}`, title: heading.title, body: [heading.lead ?? "", ...lines.slice(heading.start + 1, headings[index + 1]?.start ?? lines.length)].join("\n").trim(), phase: heading.parent || undefined, transition: "", evidenceIds: [...section.evidenceIds], kind: section.kind }))];
}

export function chapterSteps(section: FocusSection, session?: StructureSources): FocusSection[] {
  if (structureIsCurrent(section, session)) {
    const textSteps = derivedSteps(section);
    const generated = semanticChapterSteps(section).map(step => {
      // A title-only legacy node may reuse its uniquely matching article passage.
      // This is display text, not new raw evidence or an inferred relationship.
      const matches = textSteps.filter(item => item.title === step.title);
      const titleOnly = !step.body.trim() || step.body.replace(/[*_`]/gu, "").trim() === step.title;
      return titleOnly && matches.length === 1 ? { ...step, body: matches[0].body, phase: matches[0].phase } : step;
    }), used = new Set<string>();
    const saved = (section.understandingPath ?? []).flatMap(step => {
      const match = generated.find(node => node.id === step.id || node.title === step.title);
      if (match) used.add(match.id);
      if (step.origin || step.userEdited || step.structureEdited) return [step];
      return match ? [match] : [];
    });
    return [...saved, ...generated.filter(node => !used.has(node.id))];
  }
  if (!section.understandingPath) return derivedSteps(section);
  const old = section.understandingPath[0];
  if (section.understandingPath.length === 1 && old.id === `chapter-step:${section.id}:body` && !old.origin && !old.userEdited && old.title === section.title && old.body === section.body) return derivedSteps(section);
  // Restore only a previously shortened, untouched derived title. Keep authored text and order.
  const full = new Map(derivedSteps(section).map(step => [step.id, step]));
  let changed = false;
  const steps = section.understandingPath.map(step => {
    const original = full.get(step.id);
    if (!step.origin && !step.userEdited && original && step.body === original.body && step.title !== original.title && step.title === readingTitle(original.title, 36)) {
      changed = true;
      return { ...step, title: original.title };
    }
    return step;
  });
  return changed ? steps : section.understandingPath;
}

/** Keep an opening paragraph in the chapter, rather than making it a competing concept card.
 * Authored points and relation endpoints always remain visible. Editing still uses the full route. */
export function chapterConceptSteps(steps: FocusSection[]): FocusSection[] {
  const named = steps.filter(step => !/:body(?:-|$)/u.test(step.id));
  if (!named.length) return steps;
  const linked = new Set(steps.flatMap(step => (step.understandingLinks ?? []).flatMap(link => [step.id, link.targetId])));
  return steps.filter(step => named.includes(step) || step.origin || step.userEdited || step.structureEdited || linked.has(step.id));
}

/** Explicit local refresh after text changes. Authored cards and saved order win. */
export function chapterPathRefresh(section: FocusSection): FocusSection[] | undefined {
  if (section.semanticStructure) return;
  const saved = section.understandingPath;
  if (!saved?.some(step => !step.origin && !step.userEdited)) return;
  const fresh = derivedSteps(section), used = new Set<string>();
  const next = saved.flatMap(step => {
    const matches = fresh.filter(item => !used.has(item.id) && (item.title === step.title || readingTitle(item.title, 36) === step.title));
    const match = matches.length === 1 ? matches[0] : matches.find(item => item.body === step.body);
    if (match) used.add(match.id);
    if (step.origin === "user" || step.userEdited) return [step];
    if (step.structureEdited) return [match ? { ...match, id: step.id, transition: step.transition, responsibility: step.responsibility, understandingLinks: step.understandingLinks, structureEdited: true } : step];
    return match ? [{ ...match, id: step.id, transition: step.transition }] : [];
  });
  const ids = new Set(next.map(step => step.id));
  fresh.filter(step => !used.has(step.id)).forEach((step, index) => {
    let id = step.id;
    if (ids.has(id)) { let suffix = index; do { id = `chapter-refresh:${section.id}:${suffix++}`; } while (ids.has(id)); }
    ids.add(id); next.push({ ...step, id });
  });
  return JSON.stringify(next) === JSON.stringify(chapterSteps(section)) ? undefined : next;
}
