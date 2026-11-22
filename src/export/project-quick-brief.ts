import { wikiDocumentBlocks } from "../shared/wiki-document-blocks";

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
