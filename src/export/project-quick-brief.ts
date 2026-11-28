import { wikiDocumentBlocks } from "../shared/wiki-document-blocks";

import type { WikiEdition } from "../shared/wiki-reading-edition";
import { withoutEmptyWikiHeadings } from "../shared/wiki-editorial-cleanup";
import { wikiMarkdownLiteralRanges } from "../shared/wiki-document-blocks";
import { isWikiTableIntroduction } from "../shared/wiki-plan-tables";
import { wikiTableCells } from "../shared/wiki-table-source";

const QUIET_MARK = /[ \t]*(?:〔(?:建议(?:[／/]分析)?|发起人|你|资料)(?: · [^〕]+)?〕|\[(?:Suggestion(?: \/ analysis)?|Project author|You|Material)(?: · [^\]]+)?\](?!\())/gu;
const RAW_REFERENCE = /[ \t]*\[(?:S-\d+-[a-z0-9]+|来源\s*\d+|Source \d+|〔已确认\d+〕|Confirmed \d+)\](?:\(#(?:source|confirmation)-[\w-]+\))?/gu;
const TABLE_SOURCES = /^(?:表格来源|Table sources)\s*/iu;
const TABLE_LEAD = /(?:下表|见表|如下表|原文表格|对照表|Comparison table|Table from the discussion|table below|this table)/iu;
const TABLE_CAPTION_LINE = /^\*(?:下表来源[：:]|Table source:\s*)/iu;
const CELL_TRAILING_BADGE = /\s*((?:〔(?:已定|未定|此前|已更正)(?: · [^〕]+)?〕|\[(?:Decided|Open|Earlier|Corrected)(?: · [^\]]+)?\])(?:\s*\[(?:〔已确认\d+〕|Confirmed \d+)\]\(#confirmation-[\w-]+\))?(?:\s*\[(?:来源\s*\d+|Source \d+)\]\(#source-[\w-]+\))*)$/u;
const ANY_STATUS_OR_SOURCE = /〔(?:已定|未定|此前|已更正)(?: · [^〕]+)?〕|\[(?:Decided|Open|Earlier|Corrected)(?: · [^\]]+)?\]|\[(?:来源\s*\d+|Source \d+)\]\(#source-[\w-]+\)|\[(?:〔已确认\d+〕|Confirmed \d+)\]\(#confirmation-[\w-]+\)/u;
const DECIDED_BADGE = /^(?:〔已定(?: · [^〕]+)?〕|\[Decided(?: · [^\]]+)?\])/u;
const LOCATOR_HEADING = /^##\s+(?:引用定位|Citation locators)\s*$/iu;
const SOURCE_LINK_RE = /\[(?:来源\s*\d+|Source \d+)\]\(#source-S-[a-z0-9-]+\)/gu;

const normalizeTableCellKey = (cell: string) =>
  cell.replace(/\*\*|__|`/gu, "").replace(SOURCE_LINK_RE, "").replace(/\s+/gu, " ").trim().toLowerCase();

function fixSplitOrderedLists(markdown: string): string {
  const blocks = wikiDocumentBlocks(markdown);
  let result = markdown;
  const ORDERED = /^(\d+)\.\s+(.*)$/u;
  const DOUBLE_NUM = /^(\*\*)?(\d+)\.\s+(.+)$/u;

  const parseItem = (line: string) => {
    const m = ORDERED.exec(line);
    if (!m) return null;
    const dup = DOUBLE_NUM.exec(m[2]);
    return {
      outer: Number(m[1]),
      inner: dup ? Number(dup[2]) : undefined,
      boldPrefix: dup?.[1] ?? "",
      rest: dup ? dup[3] : m[2],
    };
  };

  for (let index = blocks.length - 1; index >= 0; index--) {
    const block = blocks[index];
    if (block.kind !== "list") continue;
    const rawLines = block.text.split("\n");
    if (!rawLines.some(line => parseItem(line)?.inner !== undefined)) continue;

    const prior = blocks[index - 1];
    const priorLines = prior?.kind === "list" ? prior.text.split("\n").filter(Boolean) : [];
    const priorLastItem = priorLines.length ? parseItem(priorLines[priorLines.length - 1]) : null;
    const priorLast = priorLastItem ? (priorLastItem.inner ?? priorLastItem.outer) : undefined;

    const out: string[] = [];
    let lastNum: number | undefined = priorLast;
    let firstNum: number | undefined;
    let changed = false;

    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i];
      if (!line.trim()) {
        const nextItem = parseItem(rawLines[i + 1] ?? "");
        if (nextItem?.inner !== undefined && lastNum !== undefined && nextItem.inner === lastNum + 1) {
          changed = true;
          continue;
        }
        out.push(line);
        continue;
      }
      const item = parseItem(line);
      if (!item) { out.push(line); continue; }
      if (item.inner !== undefined) {
        const num = item.inner;
        if (firstNum === undefined) firstNum = num;
        out.push(`${num}. ${item.boldPrefix}${item.rest}`);
        lastNum = num;
        changed = true;
      } else {
        if (firstNum === undefined) firstNum = item.outer;
        out.push(line);
        lastNum = item.outer;
      }
    }

    if (!changed) continue;
    if (prior && priorLast !== undefined && firstNum === priorLast + 1) {
      result = result.slice(0, prior.end) + "\n" + out.join("\n") + result.slice(block.end);
    } else {
      result = result.slice(0, block.start) + out.join("\n") + result.slice(block.end);
    }
  }
  return result;
}

function dedupeOverlappingTables(markdown: string, edition?: WikiEdition): string {
  if (edition !== "handoff" && edition !== "brief") return markdown;
  const blocks = wikiDocumentBlocks(markdown);
  let result = markdown;

  const parseRows = (tableText: string) => {
    const lines = tableText.split("\n");
    if (lines.length < 3) return null;
    return lines.slice(2).map(line => wikiTableCells(line));
  };
  const substantiveLength = (rows: string[][]) =>
    rows.flat().join("").replace(/[⭐☆\s|—–-]+/gu, "").length;
  const hasStars = (rows: string[][]) => rows.some(row => row.some(cell => /[⭐☆]/u.test(cell)));

  for (let index = blocks.length - 1; index >= 1; index--) {
    const second = blocks[index];
    if (second.kind !== "table") continue;
    let firstIndex = index - 1;
    let middleCaption: typeof blocks[number] | undefined;
    if (blocks[firstIndex]?.kind === "paragraph" && (TABLE_CAPTION_LINE.test(blocks[firstIndex].text) || TABLE_SOURCES.test(blocks[firstIndex].text) || isTableLead(blocks[firstIndex]))) {
      middleCaption = blocks[firstIndex];
      firstIndex--;
    }
    const first = blocks[firstIndex];
    if (first?.kind !== "table") continue;

    const rowsA = parseRows(first.text);
    const rowsB = parseRows(second.text);
    if (!rowsA?.length || !rowsB?.length) continue;

    const col0A = new Set(rowsA.map(row => normalizeTableCellKey(row[0] ?? "")).filter(Boolean));
    const col0B = new Set(rowsB.map(row => normalizeTableCellKey(row[0] ?? "")).filter(Boolean));
    const col0Overlap = [...col0A].filter(item => col0B.has(item)).length;
    const minEntities = Math.min(col0A.size, col0B.size);
    const sameEntities = minEntities >= 3 && col0Overlap / minEntities >= 0.75;

    const col1B = new Set(rowsB.map(row => normalizeTableCellKey(row[1] ?? "")).filter(Boolean));
    const col1A = rowsA.map(row => normalizeTableCellKey(row[1] ?? "")).filter(Boolean);
    const strictValueSubset = rowsA.length >= 2 && rowsA.length < rowsB.length
      && col1A.length === rowsA.length && col1A.every(val => col1B.has(val));

    if (!sameEntities && !strictValueSubset) continue;

    const keepSecond = strictValueSubset
      || rowsB.length > rowsA.length
      || (rowsB.length === rowsA.length && !hasStars(rowsB) && (hasStars(rowsA) || substantiveLength(rowsB) > substantiveLength(rowsA)));

    if (keepSecond) {
      // Drop the smaller/summary first table (and its own caption if it was a plain source caption)
      const beforeFirst = blocks[firstIndex - 1];
      const dropStart = beforeFirst?.kind === "paragraph" && TABLE_CAPTION_LINE.test(beforeFirst.text) ? beforeFirst.start : first.start;
      const keepStart = middleCaption ? middleCaption.start : second.start;
      result = result.slice(0, dropStart) + result.slice(keepStart);
      index = firstIndex;
    } else {
      // Keep the richer first table and preserve any source links from the dropped second table's caption
      const extraLinks = middleCaption ? [...new Set(middleCaption.text.match(SOURCE_LINK_RE) ?? [])] : [];
      const firstHasLinks = (first.text + (blocks[firstIndex - 1]?.text ?? "")).includes("#source-");
      let replacement = first.text;
      if (extraLinks.length && !firstHasLinks && edition === "handoff") {
        const zhCaption = !middleCaption || /来源/u.test(middleCaption.text);
        const cap = zhCaption ? `*下表来源：${extraLinks.join(" ")}*` : `*Table source: ${extraLinks.join(" ")}*`;
        replacement = `${cap}\n\n${first.text}`;
      }
      result = result.slice(0, first.start) + replacement + result.slice(second.end);
      index = firstIndex;
    }
  }
  return result;
}

const isTableLead = (block?: { kind: string; text: string; standaloneLabel?: boolean }) => {
  if (!block) return false;
  if (block.kind === "heading") return /^#{3,6}\s/u.test(block.text);
  if (block.kind !== "paragraph") return false;
  if (isWikiTableIntroduction(block.text) || TABLE_LEAD.test(block.text)) return true;
  return Boolean(block.standaloneLabel && !block.text.includes("→"));
};

function dedupeTableCitations(markdown: string, edition?: WikiEdition): string {
  const hoistUniform = edition === "handoff" || edition === "brief";
  const blocks = wikiDocumentBlocks(markdown);
  let result = markdown;
  for (let index = blocks.length - 1; index >= 0; index--) {
    const block = blocks[index];
    if (block.kind !== "table") continue;
    const lines = block.text.split("\n");
    if (lines.length < 3) continue;
    const [headerLine, sepLine, ...dataLines] = lines;
    let rowChanged = false;
    const parsedRows = dataLines.map(line => {
      const cells = wikiTableCells(line);
      const matches = cells.map(cell => CELL_TRAILING_BADGE.exec(cell));
      const lastColumnForBadge = new Map<string, number>();
      matches.forEach((match, col) => {
        if (match) lastColumnForBadge.set(match[1], col);
      });
      const deduped = cells.map((cell, col) => {
        const match = matches[col];
        if (!match || lastColumnForBadge.get(match[1]) === col) return cell;
        rowChanged = true;
        return cell.slice(0, match.index).trimEnd();
      });
      return { line, cells: deduped };
    });

    if (hoistUniform && parsedRows.length >= 2) {
      const rowBadges = parsedRows.map(({ cells }) =>
        cells.flatMap((cell, col) => {
          const match = CELL_TRAILING_BADGE.exec(cell);
          return match ? [{ col, badge: match[1], index: match.index }] : [];
        }));
      const firstBadge = rowBadges[0]?.length === 1 ? rowBadges[0][0].badge : "";
      const uniform = Boolean(firstBadge) && DECIDED_BADGE.test(firstBadge)
        && rowBadges.every(badges => badges.length === 1 && badges[0].badge === firstBadge);
      if (uniform) {
        const strippedRows = parsedRows.map(({ cells }, rowIndex) => {
          const hit = rowBadges[rowIndex][0];
          return cells.map((cell, col) => col === hit.col ? cell.slice(0, hit.index).trimEnd() : cell);
        });
        const cleanHeader = !ANY_STATUS_OR_SOURCE.test(headerLine);
        const cleanBody = strippedRows.every(cells => cells.every(cell => !ANY_STATUS_OR_SOURCE.test(cell)));
        if (cleanHeader && cleanBody) {
          const rebuilt = [headerLine, sepLine, ...strippedRows.map(cells => `| ${cells.join(" | ")} |`)].join("\n");
          const prior = blocks[index - 1];
          if (prior?.kind === "paragraph" && isTableLead(prior)) {
            const merged = prior.text.includes(firstBadge) ? prior.text : `${prior.text} ${firstBadge}`;
            result = result.slice(0, prior.start) + merged + "\n\n" + rebuilt + result.slice(block.end);
          } else {
            const caption = /〔/u.test(firstBadge) ? `*本表各项均为${firstBadge}*` : `*All rows ${firstBadge}*`;
            result = result.slice(0, block.start) + caption + "\n\n" + rebuilt + result.slice(block.end);
          }
          continue;
        }
      }
    }

    if (rowChanged) {
      const rebuilt = [headerLine, sepLine, ...parsedRows.map(({ cells }) => `| ${cells.join(" | ")} |`)].join("\n");
      result = result.slice(0, block.start) + rebuilt + result.slice(block.end);
    }
  }
  return result;
}

function pruneUnusedLocators(markdown: string): string {
  const blocks = wikiDocumentBlocks(markdown);
  const headingIndex = blocks.findIndex(block => block.kind === "heading" && LOCATOR_HEADING.test(block.text));
  if (headingIndex < 0) return markdown;
  let sectionEndIndex = headingIndex + 1;
  while (
    sectionEndIndex < blocks.length
    && !(blocks[sectionEndIndex].kind === "heading" && /^#{1,2}\s/u.test(blocks[sectionEndIndex].text))
    && blocks[sectionEndIndex].kind !== "thematicBreak"
  ) {
    sectionEndIndex++;
  }
  const sectionBlocks = blocks.slice(headingIndex + 1, sectionEndIndex);
  if (sectionBlocks.length !== 1 || sectionBlocks[0].kind !== "list") return markdown;
  const listBlock = sectionBlocks[0];
  const entries = listBlock.text.split(/\n(?=- )/u).map(line => {
    const id = /<a id="source-(S-\d+-[a-z0-9]+)"><\/a>/u.exec(line)?.[1];
    return id ? { id, line } : null;
  });
  if (!entries.length || entries.some(entry => !entry)) return markdown;
  const validEntries = entries as Array<{ id: string; line: string }>;

  const sectionStart = blocks[headingIndex].start;
  const sectionEnd = listBlock.end;
  const referenced = new Set<string>();
  const scanText = (slice: string) => {
    for (const match of slice.matchAll(/#source-(S-\d+-[a-z0-9]+)\b|\[(S-\d+-[a-z0-9]+)\]/gu)) {
      referenced.add(match[1] ?? match[2]);
    }
  };
  let cursor = 0;
  const literalRanges = wikiMarkdownLiteralRanges(markdown);
  const scanRange = (from: number, to: number) => {
    if (to <= from) return;
    if (to <= sectionStart || from >= sectionEnd) {
      scanText(markdown.slice(from, to));
      return;
    }
    if (from < sectionStart) scanText(markdown.slice(from, sectionStart));
    if (to > sectionEnd) scanText(markdown.slice(sectionEnd, to));
  };
  for (const { start, end } of literalRanges) {
    scanRange(cursor, start);
    cursor = end;
  }
  scanRange(cursor, markdown.length);

  const kept = validEntries.filter(entry => referenced.has(entry.id));
  if (kept.length === validEntries.length) return markdown;
  if (!kept.length) {
    const removeStart = blocks[headingIndex - 1]?.kind === "thematicBreak" ? blocks[headingIndex - 1].start : sectionStart;
    const before = markdown.slice(0, removeStart).replace(/[ \t\n]+$/u, "");
    const after = markdown.slice(sectionEnd).replace(/^[ \t\n]+/u, "");
    return [before, after].filter(Boolean).join("\n\n");
  }

  const numbered = validEntries.every(entry => /^-\s+\*\*(?:来源|Source )\d+\*\*<a id="source-/u.test(entry.line));
  if (!numbered) {
    return markdown.slice(0, listBlock.start) + kept.map(entry => entry.line).join("\n") + markdown.slice(listBlock.end);
  }
  const renumber = new Map(kept.map((entry, idx) => [entry.id, idx + 1]));
  const rebuiltList = kept.map((entry, idx) =>
    entry.line.replace(/^(-\s+\*\*)(来源|Source )\d+(\*\*<a id="source-)/u, `$1$2${idx + 1}$3`),
  ).join("\n");
  const updated = markdown.slice(0, listBlock.start) + rebuiltList + markdown.slice(listBlock.end);

  const rewriteCitations = (slice: string) => slice.replace(
    /\[(来源|Source )\d+\]\(#source-(S-\d+-[a-z0-9]+)\)/gu,
    (whole, prefix: string, id: string) => {
      const next = renumber.get(id);
      return next === undefined ? whole : `[${prefix}${next}](#source-${id})`;
    },
  );
  let output = "", prev = 0;
  for (const { start, end } of wikiMarkdownLiteralRanges(updated)) {
    output += rewriteCitations(updated.slice(prev, start)) + updated.slice(start, end);
    prev = end;
  }
  return output + rewriteCitations(updated.slice(prev));
}

export function formatProjectMarkdown(markdown: string, edition?: WikiEdition): string {
  const brief = edition === "brief";
  const clean = (text: string) => {
    let result = text
      .replace(/[ \t]*\n(?:[ \t]*\n){2,}/gu, "\n\n")
      .replace(/(?<![-<])->(?![->])(?=\s|[\p{L}\p{N}]+(?=$|[\s。、，,.;；)）])|[\p{Script=Han}]+(?=(?:->|→)))/gu, "→");
    if (brief || edition === "handoff") result = result.replace(QUIET_MARK, "");
    if (brief) result = result.replace(RAW_REFERENCE, "");
    return result;
  };
  let result = "", previous = 0;
  for (const { start, end } of wikiMarkdownLiteralRanges(markdown)) {
    result += clean(markdown.slice(previous, start)) + markdown.slice(start, end);
    previous = end;
  }
  result += clean(markdown.slice(previous));
  if (brief || edition === "handoff") {
    const blocks = wikiDocumentBlocks(result);
    for (let index = blocks.length - 1; index >= 0; index--) {
      const block = blocks[index];
      if (block.kind !== "paragraph" || !TABLE_SOURCES.test(block.text) || blocks[index + 1]?.kind !== "table") continue;
      if (brief) {
        result = result.slice(0, block.start) + result.slice(blocks[index + 1].start);
        continue;
      }
      const links = block.text.replace(TABLE_SOURCES, "").trim();
      const prior = blocks[index - 1];
      if (isTableLead(prior)) {
        const merged = prior.text.includes(links) ? prior.text : `${prior.text} ${links}`;
        result = result.slice(0, prior.start) + merged + "\n\n" + result.slice(blocks[index + 1].start);
        continue;
      }
      const caption = /^表格来源/iu.test(block.text) ? `*下表来源：${links}*` : `*Table source: ${links}*`;
      result = result.slice(0, block.start) + caption + result.slice(block.end);
    }
  }
  result = fixSplitOrderedLists(result);
  result = dedupeOverlappingTables(result, edition);
  result = dedupeTableCitations(result, edition);
  result = pruneUnusedLocators(result);
  const tidied = withoutEmptyWikiHeadings(result);
  return tidied.trimEnd() + "\n";
}

const LIMIT = 2000;
const OVERVIEW = /^(?:项目总览|Project overview)$/iu;
const DECISIONS = /^(?:当前规划|已定的关键决定|Current plan|Key decisions)$/iu;
const PENDING = /^(?:待决事项|Open questions)$/iu;
const INDEX = /^(?:引用定位|整理确认记录|Citation locators|Organization confirmations)$/iu;
const SUPPLEMENT = /^(?:项目事项|项目演变|关键证据|来源索引|参考示例|文档说明|Project matters|Project evolution|Key evidence|Source index|Reference examples|Document notes)$/iu;
const CITE = /\[([^\]\n]+)\]\(#((?:source|confirmation)-[\w-]+)\)/gu;
const ANCHOR = /<a id="((?:source|confirmation)-[\w-]+)"><\/a>/u;
const DECIDED = /〔已定〕|\[Decided\]/iu;
const PROPOSAL = /版本未定|AI\s*(?:建议|proposal)|讨论中的建议|参考流程|建议／分析|Earlier version/iu;
const indivisibleItems = (kind: string, text: string) => kind === "list" ? text.split(/\n(?=[-*+]\s|\d+\.\s)/u) : [text];

/** Select self-contained blocks and include the anchors they use. The limit
 * applies to the complete Markdown, including its hidden locator metadata. */
export function projectQuickBrief(markdown: string, zh: boolean) {
  const intro: string[] = [], decisions: string[] = [], flows: string[] = [], pending: string[] = [], fallback: string[] = [];
  const citations = new Map<string, string>();
  let title = "", status = "", section = "", topic = "", discussion = false, diagram = "";
  for (const block of wikiDocumentBlocks(markdown)) {
    const { kind, text } = block;
    if (diagram) {
      if (kind === "list" && text.includes("→") && !PROPOSAL.test(text)) flows.push(diagram + "\n\n" + text);
      diagram = "";
    }
    if (kind === "heading") {
      const match = /^(#+)\s+(.+)$/u.exec(text);
      if (!match) continue;
      const [, level, label] = match;
      if (level.length === 1 && !title) title = text;
      if (level.length === 2) { section = label; topic = ""; discussion = false; }
      if (level.length === 3) {
        topic = label;
        discussion = /早先|历史|建议|讨论|Earlier|History|Suggestions|Discussion/iu.test(topic);
      }
      continue;
    }
    if (INDEX.test(section) && kind === "list") {
      for (const entry of indivisibleItems(kind, text)) {
        const anchor = ANCHOR.exec(entry)?.[1];
        if (anchor) citations.set(anchor, entry);
      }
      continue;
    }
    if (PENDING.test(section) && kind === "list") { pending.push(...indivisibleItems(kind, text)); continue; }
    if (!section && kind === "paragraph" && /^(?:文档状态[：:]|Document status:)/iu.test(text)) status = text.split("\n", 1)[0].trim();
    if (discussion || SUPPLEMENT.test(section) || INDEX.test(section) || !section) continue;
    if (OVERVIEW.test(section)) {
      if (!topic && kind === "paragraph" && !block.standaloneLabel && !PROPOSAL.test(text)) intro.push(text);
      if (DECISIONS.test(topic) && kind === "list") decisions.push(...indivisibleItems(kind, text));
      if (DECISIONS.test(topic) && kind === "table") {
        const [header, separator, first] = text.split("\n");
        if (first) decisions.push([header, separator, first].join("\n"));
      }
      continue;
    }
    if (PROPOSAL.test(text)) continue;
    if (kind === "code" && /^(?:`{3,}|~{3,})mermaid\b/iu.test(text)) diagram = text;
    else if (kind === "paragraph" && text.includes("→")) flows.push(text);
    else if (kind === "paragraph" && DECIDED.test(text)) decisions.push(text);
    else if (kind === "paragraph" && !block.standaloneLabel) fallback.push(text);
  }

  const groups = [
    { heading: "", items: intro.length ? intro : fallback, count: 1, budget: 280 },
    { heading: zh ? "关键决定" : "Key decisions", items: decisions, count: 4, budget: 780 },
    { heading: zh ? "核心流程" : "Core workflow", items: flows, count: 1, budget: 360 },
    { heading: zh ? "待决事项" : "Open questions", items: pending, count: 3, budget: 440 },
  ];
  const heading = title.length > 200 ? title.slice(0, 197).trimEnd() + "…" : title || (zh ? "# 项目速读" : "# Project brief");
  const used = new Set<string>(), seen = new Set<string>();
  let body = heading + "\n\n" + (status && status.length <= 160 ? status : zh ? "实现未核验。" : "Implementation unverified.");
  const compose = (text: string, ids: ReadonlySet<string>) => {
    const entries = [...ids].flatMap(id => citations.get(id) ?? []);
    return text + (entries.length ? "\n\n## " + (zh ? "引用定位" : "Citation locators") + "\n\n" + entries.join("\n") : "") + "\n";
  };
  for (const group of groups) {
    let count = 0, size = 0;
    for (const item of group.items) {
      if (count >= group.count) break;
      const ids = new Set(used);
      const content = item.replace(CITE, (_match, label: string, id: string) => {
        if (!citations.has(id)) return label;
        ids.add(id);
        return _match;
      }).replace(/\[([^\]\n]+)\]\(#(?!source-|confirmation-)[^\s)]+\)/gu, "$1");
      const key = content.replace(CITE, "").replace(/[^\p{L}\p{N}]+/gu, "") || content;
      const candidate = body + "\n\n" + (!count && group.heading ? "## " + group.heading + "\n\n" : "") + content;
      if (seen.has(key) || size + content.length > group.budget || compose(candidate, ids).length > LIMIT) continue;
      body = candidate;
      ids.forEach(id => used.add(id));
      seen.add(key);
      size += content.length;
      count++;
    }
  }
  return compose(body, used);
}
