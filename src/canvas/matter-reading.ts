import type { ProjectMatter } from "../shared/project-matters";
import { matterTitle } from "../shared/project-matters";

/** Reading labels only: never rewrite the stored question or resolution. */
export function matterReadingTitle(matter: ProjectMatter) {
  if (matter.displayTitle) return matter.displayTitle;
  return matterTitle(matter).replace(/[？?]$/, "").replace(/是否可用$/, "验证").replace(/^如何(?=验证|确定|完善|处理)/, "");
}

const normalized = (value: string) => value.normalize("NFKC").replace(/[*`#>\s]/g, "").replace(/[。.!！；;]+$/, "");
const sentences = (value: string) => value.split(/(?<=[。！；;\n])|(?<=[.!])\s+/).map(part => part.trim()).filter(Boolean);

/** Keep literal caveats; a short preview must never turn partial validation into completion. */
export function matterReadingSummary(matter: ProjectMatter, body = "", zh = true) {
  const parts = [matter.resolution?.trim() ?? ""];
  const caveats = sentences(matter.resolutionReason ?? "").filter(value => /仍|尚|未|待|暂不|仅|限制|不代表|需要|需单独|not\b|still\b|pending\b|only\b|remain\b|must\b/i.test(value));
  parts.push(...caveats);
  if (matter.type === "boundary") {
    if (matter.excluded) parts.push(`${zh ? "暂不包含" : "Excluded"}：${matter.excluded}`);
    if (matter.phase) parts.push(`${zh ? "适用阶段" : "Phase"}：${matter.phase}`);
  }
  const unique = parts.filter((value, index) => value && !parts.slice(0, index).some(previous => normalized(previous).includes(normalized(value))));
  // Quotes and code examples are not assertions by the article itself.
  const articleProse = body.replace(/```[^\n]*\n[\s\S]*?```|~~~[^\n]*\n[\s\S]*?~~~/g, "").replace(/^\s*>.*$/gm, "");
  const articleSentences = sentences(articleProse).map(normalized);
  return { text: unique.join(" "), inBody: Boolean(unique.length && unique.flatMap(sentences).every(value => articleSentences.includes(normalized(value)))) };
}
