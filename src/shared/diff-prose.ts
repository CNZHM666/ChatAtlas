import { WIKI_EVIDENCE_LINK } from "./wiki-evidence-link";
import { isSourceCaption } from "./wiki-source-code";

const EVIDENCE_LINK_RE = new RegExp(
  `\\s*\\[[^\\]\\n]{1,28}\\]\\(<?${WIKI_EVIDENCE_LINK.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}[^)>\\n]+>?\\)`,
  "gu",
);
const INTERNAL_REF_RE = /[ \t]*\[S-\d+-[a-z0-9]+\]/giu;
const SOURCE_CAPTION_RE = /^\*(?:讨论中的原文(?:代码|表格)|代码|表格|(?:Code|Table) from the discussion)\s*·[^*\n]+\*$/u;
const EXAMPLE_HEADING_RE = /^#{1,6}\s+(?:参考示例|原文与示例|流程示例|原文示例|界面草图|数据结构|命令示例|JSON\s*示例|目录结构|Reference examples?|Originals and examples|Flow example|Source example|UI sketch|Data structure|Command example|File layout)(?:\s*·.*)?$/iu;
const STANDALONE_SOURCE_LINE_RE = /^(?:原文来源|表格来源|代码来源|参考来源|Original source|Table source|Source)\s*[:：]?\s*$/iu;

/**
 * Strip non-prose wiki supplements so version/chapter diffs compare only readable prose:
 * - Collapsed `<details ...>参考示例...</details>` supplement blocks
 * - `*讨论中的原文代码 · AI 建议，未确认*` and similar source captions
 * - Fenced code blocks (` ```text ... ``` `, ` ~~~...~~~ `)
 * - Orphaned "参考示例" headings and internal evidence links (`#atlas-original-...`, `[S-1-a]`)
 */
export function extractComparisonProse(markdown: string): string {
  if (!markdown) return "";
  // 1. Remove <details>...</details> supplement blocks (e.g. 参考示例).
  const withoutDetails = markdown
    .replace(/<details\b[^>]*>[\s\S]*?<\/details>/giu, "\n")
    .replace(EVIDENCE_LINK_RE, "")
    .replace(INTERNAL_REF_RE, "");

  // 2. Walk lines to drop fenced code blocks, source captions, and standalone source labels.
  const lines = withoutDetails.replace(/\r\n?/gu, "\n").split("\n");
  const kept: string[] = [];
  let inFence: { char: "`" | "~"; length: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (inFence) {
      const closeMatch = /^(`{3,}|~{3,})\s*$/u.exec(trimmed);
      if (closeMatch && closeMatch[1][0] === inFence.char && closeMatch[1].length >= inFence.length) {
        inFence = null;
      }
      continue;
    }

    const openMatch = /^(`{3,}|~{3,})/u.exec(trimmed);
    if (openMatch) {
      inFence = { char: openMatch[1][0] as "`" | "~", length: openMatch[1].length };
      // If the immediately preceding kept non-empty line was a source caption, drop it too.
      while (kept.length > 0 && !kept[kept.length - 1].trim()) kept.pop();
      if (kept.length > 0) {
        const prev = kept[kept.length - 1].trim();
        if (SOURCE_CAPTION_RE.test(prev) || isSourceCaption(prev, { type: "code", text: trimmed })) {
          kept.pop();
        }
      }
      continue;
    }

    if (SOURCE_CAPTION_RE.test(trimmed)) continue;
    if (STANDALONE_SOURCE_LINE_RE.test(trimmed)) continue;

    // Generic italic source caption immediately followed by a fenced code block or markdown table
    if (/^\*[^*\n]+\*$/u.test(trimmed)) {
      let next = i + 1;
      while (next < lines.length && !lines[next].trim()) next++;
      const nextTrimmed = lines[next]?.trim() ?? "";
      if (/^(`{3,}|~{3,})/u.test(nextTrimmed)) continue;
      if (isSourceCaption(trimmed, { type: /^\s*\|/u.test(nextTrimmed) ? "table" : "paragraph", text: nextTrimmed })) {
        continue;
      }
    }

    if (EXAMPLE_HEADING_RE.test(trimmed)) {
      // Drop standalone example headings if the next content is another heading, fence, or EOF.
      let next = i + 1;
      while (next < lines.length && !lines[next].trim()) next++;
      const nextTrimmed = lines[next]?.trim() ?? "";
      if (!nextTrimmed || /^#{1,6}\s/u.test(nextTrimmed) || /^(`{3,}|~{3,})/u.test(nextTrimmed) || SOURCE_CAPTION_RE.test(nextTrimmed)) {
        continue;
      }
    }

    kept.push(line);
  }

  // 3. Remove any headings that became empty after stripping examples/code blocks underneath them.
  const pruned: string[] = [];
  for (let i = 0; i < kept.length; i++) {
    const trimmed = kept[i].trim();
    const headingMatch = /^(#{1,6})\s+/u.exec(trimmed);
    if (headingMatch) {
      const level = headingMatch[1].length;
      let next = i + 1;
      while (next < kept.length && !kept[next].trim()) next++;
      const nextTrimmed = kept[next]?.trim() ?? "";
      const nextHeading = /^(#{1,6})\s+/u.exec(nextTrimmed);
      if (!nextTrimmed || (nextHeading && nextHeading[1].length <= level)) {
        continue;
      }
    }
    pruned.push(kept[i]);
  }

  return pruned.join("\n").replace(/\n{3,}/gu, "\n\n").trim();
}
