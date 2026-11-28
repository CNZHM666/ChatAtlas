import type { FocusSection, FocusSession } from "./focus-session";
import { projectKnowledgeReading, projectKnowledgeReadingContext } from "./project-knowledge-view";
import { WIKI_EVIDENCE_LINK } from "./wiki-evidence-link";
import { isSourceCaption } from "./wiki-source-code";

const EVIDENCE_LINK_RE = new RegExp(
  `\\s*\\[[^\\]\\n]{1,28}\\]\\(<?${WIKI_EVIDENCE_LINK.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}[^)>\\n]+>?\\)`,
  "gu",
);
const INTERNAL_REF_RE = /[ \t]*\[S-\d+-[a-z0-9]+\]/giu;
const SOURCE_CAPTION_RE = /^\*(?:讨论中的原文(?:代码|表格)|(?:Code|Table) from the discussion)\s*·[^*\n]+\*$/u;
const STANDALONE_SOURCE_LINE_RE = /^(?:原文来源|表格来源|代码来源|Original source|Table source)\s*[:：]?\s*$/iu;

/**
 * Strip internal Wiki markup that never appears verbatim in the reading view:
 * - Collapsed `<details data-atlas="atlas-wiki-supplement">...</details>` reference-example wrappers
 * - `*讨论中的原文代码 · AI 建议，未确认*` and similar source-code/table captions (and raw `text` sketch fences right beneath them)
 * - Internal evidence anchor links (`#atlas-original-...`, `[S-1-a]`) and orphaned "原文来源" lines
 */
export function cleanEditableChapterProse(markdown: string): string {
  if (!markdown) return "";
  const stripped = markdown
    .replace(/<details\b[^>]*data-atlas=["']atlas-wiki-supplement["'][^>]*>[\s\S]*?<\/details>/giu, "\n")
    .replace(EVIDENCE_LINK_RE, "")
    .replace(INTERNAL_REF_RE, "");

  const lines = stripped.replace(/\r\n?/gu, "\n").split("\n");
  const kept: string[] = [];
  let skipFence: { char: "`" | "~"; length: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (skipFence) {
      const closeMatch = /^(`{3,}|~{3,})\s*$/u.exec(trimmed);
      if (closeMatch && closeMatch[1][0] === skipFence.char && closeMatch[1].length >= skipFence.length) {
        skipFence = null;
      }
      continue;
    }

    if (STANDALONE_SOURCE_LINE_RE.test(trimmed)) continue;

    if (SOURCE_CAPTION_RE.test(trimmed)) {
      let next = i + 1;
      while (next < lines.length && !lines[next].trim()) next++;
      const nextLine = lines[next]?.trim() ?? "";
      // If the discussion caption introduces a raw `text` sketch/ASCII block that reading mode collapses, skip that raw fence too.
      const textFence = /^(`{3,}|~{3,})\s*(?:text|txt)?\s*$/iu.exec(nextLine);
      if (textFence) {
        i = next;
        skipFence = { char: textFence[1][0] as "`" | "~", length: textFence[1].length };
      }
      continue;
    }

    if (/^\*[^*\n]+\*$/u.test(trimmed)) {
      let next = i + 1;
      while (next < lines.length && !lines[next].trim()) next++;
      const nextLine = lines[next]?.trim() ?? "";
      if (isSourceCaption(trimmed, { type: /^(`{3,}|~{3,})/.test(nextLine) ? "code" : "table", text: nextLine })) {
        continue;
      }
    }

    kept.push(line);
  }

  return kept.join("\n").replace(/\n{3,}/gu, "\n\n").trim();
}

/**
 * Prepare a chapter's Markdown body for editing in either Workspace or Sidecar:
 * - Manually authored/edited chapters open with their exact saved Markdown untouched.
 * - Unedited AI-generated chapters open with the clean readable projection (free of hidden source captions and internal links).
 */
export function prepareEditableChapterBody(
  session: FocusSession,
  chapter: FocusSection,
  projectedBody?: string,
): string {
  if (chapter.userEdited || chapter.origin || session.mode !== "work") return chapter.body;
  if (projectedBody !== undefined) return cleanEditableChapterProse(projectedBody);
  try {
    const context = projectKnowledgeReadingContext(session);
    const projected = projectKnowledgeReading(
      context.chapters.find((item) => item.id === chapter.id) ?? chapter,
      session,
      context.view,
      context.chapters,
      true,
    );
    return cleanEditableChapterProse(projected?.body ?? chapter.body);
  } catch {
    return cleanEditableChapterProse(chapter.body);
  }
}
