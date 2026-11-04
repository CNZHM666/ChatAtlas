import { knowledgeTerms } from "../shared/knowledge-subject";
import type { WikiDraftChapter } from "../shared/wiki-knowledge";

/** A scope table's cell leaving an item out of the first version. */
const LEFT_OUT = /^(?:不做|暂缓|暂缓开发|不实现|不开发|暂不(?:做|实现|开发))$/u;
/** A clause putting something in the first version. */
const PRIORITY = /P0|为核心|核心功能|第一版(?:做|实现|支持|包含)|首期(?:做|实现|支持)/u, LEAVES = /不做|暂缓|不实现|不开发|不进行|暂不/u;
/** "全平台同步" left out is the same item as "支持 ChatGPT、Claude、Gemini 等平台的完整同步" put in. */
const ALL_SYNC = /(?:全|多|跨|各)平台[^|]*同步|完整同步/u, MANY_SYNC = /(?:Claude|Gemini|多平台|全平台|跨平台|各平台)[^。；;]*同步|同步[^。；;]*(?:Claude|Gemini|多平台|全平台)/iu;
const MAX_NOTES = 4, CLAUSE_LENGTH = 48;
/** Latin words every project uses: "商城API对接" matched by API alone was "用户自行接入 API" (the model API), and the
 * user was asked to settle two unrelated things. An item with only these keeps its whole wording. */
const GENERIC_NAME = /^(?:AI|UI|UX|API|APP|LLM|SDK|ID|KEY|TOKEN|WEB|URL)$/iu;
/** Words narrowing a left-out item ("实时全网比价"): a decision the user confirmed naming its core ("提供比价推荐及链接")
 * puts it in. */
const NARROWING = /^(?:实时|全网|在线|自动|完整的?|复杂的?|真实的?|多平台|跨平台)+/u;
/** A clause proposing to use something, and one already placing it later ("后期集成 Wokwi" says it is not now). */
const NEGATED_USE = /(?:不|未|无|没|禁止|别|勿|严禁|暂不)(?:再)?(?:利用|集成|接入|使用|采用|引入|导出至|导出到)/u;
/** A flow written as steps ("…→ BOM/代码生成 → Wokwi 仿真"): an item in it is a step the flow does. */
const CHAIN = /->|→|=>/u, CHAIN_STEP = /(?:->|→|=>)\s*$/u;
const USE = /利用|集成|接入|使用|采用|引入|导出至|导出到/u, LATER = /后期|后续|之后|以后|未来|稳定后|再接入|V[2-9]/u;
/** A list or sentence leaving items out: the verb, then the items up to 等 or the clause's end. */
const LEFT_OUT_LIST = /(暂缓开发|暂缓|不实现|不做|不开发|不进行)[：:]?\s*([^。；;\n]{2,90}?)(?=等|[。；;\n]|$)/gu;
/** The stage a clause speaks of: an iteration (本阶段, Milestone 3.2) or a version (V1, 第一版), by its label; V0.x and V1
 * are the first version. */
const ITERATION = /本阶段|当前阶段|现阶段|本轮|本次迭代|当前迭代|Milestone\s*[\d.]+|里程碑\s*[\d.]+|\bthis (?:phase|iteration|sprint|round)\b|\bcurrent (?:phase|iteration)\b/iu, VERSION = /\bV\d+(?:\.\d+)?|第一版|首版|\bMVP\b|正式版|\bfirst (?:version|release)\b/iu;
export function stageOf(clause: string): { level: "iteration" | "version"; label: string } | undefined {
  const iteration = clause.match(ITERATION), version = clause.match(VERSION);
  if (iteration) return { level: "iteration", label: /^(?:本阶段|当前阶段|现阶段|本轮|本次迭代|当前迭代|this (?:phase|iteration|sprint|round)|current (?:phase|iteration))$/iu.test(iteration[0]) ? "current" : iteration[0].replace(/\s+/gu, "").toLocaleLowerCase() };
  if (version) return { level: "version", label: /第一版|首版|mvp|first (?:version|release)|^v0(?:\.\d+)?$|^v1(?:\.0)?$/iu.test(version[0]) ? "first" : version[0].toLocaleLowerCase() };
}
/** The stage word a statement names ("本阶段", "Milestone 3.2", "V1"), as it is written. */
export const stageWord = (text: string) => (text.match(ITERATION) ?? text.match(VERSION))?.[0];
/** The sentence or line holding a position. */
const clauseAt = (text: string, at: number) => {
  const start = Math.max(...["\n", "。", "；"].map(mark => text.lastIndexOf(mark, at - 1))) + 1, rest = text.slice(at).search(/[。；\n]/u);
  return text.slice(start, rest < 0 ? text.length : at + rest);
};
const plain = (text: string) => text.replace(/\*\*|__/gu, "").replace(/^\s*(?:[-*+]|\d+\.)\s+/u, "").trim();
const short = (text: string) => { const value = plain(text).replace(/[。；;]$/u, ""); return value.length <= CLAUSE_LENGTH ? value : `${value.slice(0, CLAUSE_LENGTH - 1)}…`; };

/** Where a part of an item stands in a clause, ignoring case: a Latin name only as a whole word. -1 when absent. */
function nameAt(clause: string, part: string) {
  if (!/^[A-Za-z][\w.+#-]*$/u.test(part)) return clause.toLocaleLowerCase().indexOf(part.toLocaleLowerCase());
  return clause.search(new RegExp(`(?<![A-Za-z0-9])${part.replace(/[.+#]/gu, "\\$&")}(?![A-Za-z0-9])`, "iu"));
}
/** A clause putting something first, not leaving it out: "提前实现非核心功能" and "禁止……核心功能" say no priority. */
function affirmsPriority(clause: string) {
  const match = clause.match(PRIORITY);
  return Boolean(match) && !/非|禁止|严禁|避免|不(?:要|得|做)?|勿|无需/u.test(clause.slice(Math.max(0, (match!.index ?? 0) - 8), match!.index));
}
/** A first-version scope stated both ways: a scope table leaves an item out ("Wiki/知识图谱/自动同步 | 暂缓") while a
 * sentence elsewhere puts it in ("……Dashboard/Wiki及原文定位为P0或核心"). Each chapter's writer sees only its own
 * units, so neither knows of the other, and the reader cannot tell which holds. No rule can say which: the
 * disagreement is noted right after the table, for the user to settle. decided: the claims that state a decision the
 * user confirmed, which put an item in whatever their verb. Returns how many notes were added. */
export function scopeDisagreements(chapters: WikiDraftChapter[], decided: Set<string> = new Set(), outside: (paragraph: WikiDraftChapter["paragraphs"][number]) => boolean = () => false): number {
  // A paragraph about another product says what that product does: "NeuroBoard 使用 LangGraph 进行 Agent 编排" was read
  // as this project using LangGraph. outside tells such paragraphs, which are not compared.
  const own = (chapter: WikiDraftChapter) => chapter.paragraphs.filter(paragraph => !outside(paragraph));
  const confirmed = chapters.flatMap(chapter => own(chapter).flatMap(paragraph => (paragraph.claims ?? []).filter(claim => decided.has(claim.text) && !LEAVES.test(claim.text)).map(claim => ({ chapter, clause: claim.text }))));
  const clauses = chapters.flatMap(chapter => own(chapter).flatMap(paragraph => paragraph.text.split(/(?<=[。；;])|\n/u)
    .filter(clause => !clause.trim().startsWith("|") && affirmsPriority(clause) && !LEAVES.test(clause)).map(clause => ({ chapter, clause }))));
  const uses = chapters.flatMap(chapter => own(chapter).flatMap(paragraph => paragraph.text.split(/(?<=[。；;])|\n/u)
    .filter(clause => !clause.trim().startsWith("|") && (USE.test(clause) || CHAIN.test(clause)) && !LEAVES.test(clause) && !LATER.test(clause)).map(clause => ({ chapter, clause }))));
  let added = 0;
  const noted = new Set<string>();
  for (const chapter of chapters) for (const paragraph of chapter.paragraphs) {
    const notes: string[] = [];
    // Left out in a scope table's row, or in a list or sentence ("暂缓开发：完整 Wiki 自动生成、3D 知识球……",
    // "不实现 Wiki、知识图谱、自动同步等所有功能"), each item on its own.
    const rows = [...paragraph.text.matchAll(/^\|([^|\n]+)\|([^|\n]+)\|/gmu)].flatMap(row => LEFT_OUT.test(row[2].trim()) ? [{ item: plain(row[1]), cell: row[2].trim(), whole: true }] : []);
    const unlisted = paragraph.text.replace(/^\|.*$/gmu, "");
    const listed = [...unlisted.matchAll(LEFT_OUT_LIST)].flatMap(match => { const stage = stageOf(clauseAt(unlisted, match.index ?? 0)); return match[2].split(/[、，,]|和|与|及|或/u).map(part => plain(part).replace(/^(?:所有|全部|完整的?)$/u, "")).filter(part => part.length >= 2 && !/功能$|^等/u.test(part)).map(item => ({ item, cell: match[1], whole: false, stage })); });
    for (const { item, cell, whole, stage } of [...rows.map(row => ({ ...row, stage: undefined })), ...listed]) {
      if (added + notes.length >= MAX_NOTES) break;
      // A long item is matched by its Latin names ("完整 Wiki 自动生成" by Wiki), a short one by itself.
      const names = item.match(/[A-Za-z][\w.+#-]*/gu)?.filter(name => name.length >= 3 && !GENERIC_NAME.test(name)) ?? [];
      const parts = whole ? item.split(/[/、,，]|和|与|及/u).map(part => part.trim()).filter(part => part.length >= 2) : names.length ? names : [item];
      // A Latin name is a whole word ("Code" is not in "Hardcode"), and an item of several names needs them all ("Code
      // Generation" is not "禁止大量 Hardcode").
      const mentions = (clause: string) => (names.length > 1 && !whole ? parts.every(part => nameAt(clause, part) >= 0) : parts.some(part => nameAt(clause, part) >= 0)) || ALL_SYNC.test(item) && MANY_SYNC.test(clause);
      // Or proposed elsewhere as a thing to use ("不实现 Wokwi 仿真" beside "利用 Wokwi 进行浏览器端仿真"): it reads as
      // done now unless the reader is told the first version leaves it out.
      // "不接入实时比价" says not to use it: a use word after a negation is no proposal.
      const usesIt = (clause: string) => parts.some(part => { const at = nameAt(clause, part); const before = clause.slice(Math.max(0, at - 6), at); return at > 0 && !NEGATED_USE.test(before) && (USE.test(before.slice(-4)) || CHAIN_STEP.test(before)); });
      // Left out of one stage, put in another, both hold: "本阶段不进行 Wokwi" beside "V1 阶段导出至 Wokwi" is a plan,
      // not a disagreement. Only clauses of the same stage, or naming none, are compared.
      const sameStage = (clause: string) => { const theirs = stageOf(clause); return !stage || !theirs || stage.level === theirs.level && stage.label === theirs.label; };
      const core = whole || names.length ? "" : item.replace(NARROWING, "");
      const yours = core.length >= 2 ? confirmed.find(({ clause }) => clause.includes(core) && sameStage(clause)) : undefined;
      const found = clauses.find(({ clause }) => mentions(clause) && sameStage(clause)) ?? yours ?? (whole ? undefined : uses.find(({ clause }) => usesIt(clause) && sameStage(clause)));
      if (!found || noted.has(parts.join("|").toLocaleLowerCase())) continue;
      noted.add(parts.join("|").toLocaleLowerCase());
      const where = paragraph.text.includes(found.clause.trim()) ? "同一处" : found.chapter === chapter ? "下文" : `「${found.chapter.title}」中`;
      const proposes = !affirmsPriority(found.clause);
      notes.push(found === yours ? `> 范围有分歧：「${item}」写为${cell}，${where}有你确认过的「${short(found.clause)}」。这是后期方向还是第一版要做，需要你确认。`
        : proposes ? `> 范围有分歧：「${item}」写为${cell}，${where}又建议「${short(found.clause)}」。这是后期方向还是第一版要做，需要你确认。`
        : `> 范围有分歧：「${item}」写为${cell}，${where}又写「${short(found.clause)}」。第一版是否包含，需要你确认。`);
    }
    if (!notes.length) continue;
    chapter.body = chapter.body.replace(paragraph.text, `${paragraph.text}\n\n${notes.join("\n>\n")}`);
    added += notes.length;
  }
  return added;
}

/** A line leaving several items out of a stage ("当前阶段禁止扩展 PCB、KiCad、Wokwi……，仅聚焦 AI 理解层"): its stage,
 * the verb, the items and what it keeps to instead. */
const LEFT_OUT_LINE = /^(.{0,30}?)(?:明确|严格)?(禁止(?:开发|扩展|实现|加入)?|不进行|不做|不开发|不实现|暂缓开发|暂缓|暂不(?:做|实现|开发)?)\s*[：:]?\s*([^。；;]+?)(?:[，,；;]\s*((?:仅|只)[^。；;]+))?[。；;]?$/u;
const SCOPE_ITEMS_MIN = 3, SCOPE_LINES_MIN = 2;
const itemKey = (item: string) => item.toLocaleLowerCase().replace(/\s+/gu, "");
/** Lists of one paragraph each leaving items out of a stage, five lines that differ in a word or two ("本阶段禁止开发
 * PCB、KiCad、Gerber、Wokwi……" four times), as one table: a row per line, its stage, the items it leaves out (after the
 * first row, only those no row above names) and what it keeps to. Each row cites the line's own claims. Returns how
 * many lines were merged. */
export function scopeTables(chapters: WikiDraftChapter[]): number {
  let merged = 0;
  for (const chapter of chapters) for (const paragraph of chapter.paragraphs) {
    const lines = paragraph.text.split("\n");
    const read = lines.map(line => {
      if (!/^\s*[-*+]\s/u.test(line)) return undefined;
      const match = plain(line).match(LEFT_OUT_LINE);
      if (!match) return undefined;
      const items = match[3].replace(/^(?:涉及|包括|包含)/u, "").split(/[、，,]|以及|及|和|与/u).map(item => item.replace(/^(?:所有|全部)|等(?:功能)?$/u, "").trim()).filter(item => item.length >= 2);
      if (items.length < SCOPE_ITEMS_MIN) return undefined;
      const stage = match[1].replace(/^(?:在|于)/u, "").replace(/[，,：:\s]+$/u, "").trim();
      return { line, stage, items, keeps: match[4]?.trim() ?? "" };
    });
    const found = read.flatMap(row => row ? [row] : []);
    if (found.length < SCOPE_LINES_MIN) continue;
    const seen = new Set<string>(), cells = found.map((row, index) => {
      const fresh = row.items.filter(item => !seen.has(itemKey(item)));
      row.items.forEach(item => seen.add(itemKey(item)));
      return [row.stage || "未注明", index === 0 ? row.items.join("、") : fresh.length ? `另加 ${fresh.join("、")}` : "同上", row.keeps || "—"];
    });
    const rows = cells.map(cell => `| ${cell.join(" | ")} |`);
    // A line's claims move to its row: its 不做 cell, or, where that says 同上, the cell that is its own.
    const owner = (claim: string) => found.findIndex(row => plain(row.line).replace(/\s+/gu, "").includes(plain(claim).replace(/[。；;]$/u, "").replace(/\s+/gu, "")));
    paragraph.claims = (paragraph.claims ?? []).map(claim => { const at = owner(claim.text); if (at < 0) return claim; const [stage, out, keeps] = cells[at]; return { ...claim, text: out !== "同上" ? out : keeps !== "—" ? keeps : stage }; });
    const table = ["| 阶段 | 不做 | 只做 |", "| --- | --- | --- |", ...rows].join("\n");
    // The table takes the first line's place; the other lines go.
    const first = lines.indexOf(found[0].line), others = new Set(found.slice(1).map(row => row.line));
    const text = lines.flatMap((line, index) => index === first ? [table] : others.has(line) ? [] : [line]).join("\n").replace(/([^\n])\n(\| 阶段 \|)/u, "$1\n\n$2").replace(/(\|\n)(?=[^|\n])/u, "$1\n");
    chapter.body = chapter.body.replace(paragraph.text, text);
    paragraph.text = text;
    merged += found.length;
  }
  return merged;
}

/** One name told as still to come ("未来可新增 LLMInterpreter") and as done ("LLMInterpreter……已具备较高成熟度"): the
 * reader cannot tell which holds now. */
const TO_COME = /(?:(?:未来|后续|以后|之后|将来|下一阶段)(?:可|将|再|会)?(?:新增|引入|加入|实现|支持|接入)|\b(?:will|could|can later|plan to|planned to) (?:add|introduce|support|implement|build)(?: a| an| the)?)\s*$/iu, DONE = /^[^。；;.]{0,40}?(?:已具备|已完成|已实现|已上线|已接入|已支持|较高成熟度|已经成熟|\b(?:is|are) (?:already |now )?(?:done|implemented|shipped|mature|in place)\b)/iu;
const CLASH_NAME = /[A-Z][A-Za-z0-9]{4,}/gu;
/** Each such name is noted on the chapter that tells it as done. Returns how many. */
export function statusClashes(chapters: WikiDraftChapter[]): number {
  const told = new Map<string, { coming: boolean; done?: WikiDraftChapter }>();
  for (const chapter of chapters) for (const paragraph of chapter.paragraphs) for (const match of paragraph.text.matchAll(CLASH_NAME)) {
    const at = match.index ?? 0, name = match[0], entry = told.get(name) ?? { coming: false };
    if (TO_COME.test(paragraph.text.slice(Math.max(0, at - 20), at))) entry.coming = true;
    // Done when the name's own clause says so, in a list of parts ("LocalInterpreter, LLMInterpreter……已具备").
    if (DONE.test(paragraph.text.slice(at + name.length))) entry.done ??= chapter;
    told.set(name, entry);
  }
  let noted = 0;
  for (const [name, entry] of told) if (entry.coming && entry.done) { entry.done.problems.push(`"${name}" is told both as still to come and as done; say which holds now and mark the earlier one 此前`); noted++; }
  return noted;
}

/** Rows of one table telling one mechanism under other names (混合检索, 双路检索, 两阶段搜索: Orama full text with
 * optional semantic search, fused): their cells share most terms. Such rows become one, named by all its names, the
 * first row's cells kept and each other row's clauses added where they say something the kept cells do not. */
const ROW_SHARED = 5, ROW_COVER = .3, NEW_CLAUSE = .5;
/** Rows named by products (Memex, ChatsRecall) are different things however alike their cells: only rows whose
 * names carry no Latin name of their own are merged. Restated mechanisms scored .31-.44, rows about other
 * things 0. */
const NAMED = /[A-Za-z]/u;
const overlap = (a: Set<string>, b: Set<string>) => { let shared = 0; for (const term of a) if (b.has(term)) shared++; return { shared, cover: shared / Math.max(1, Math.min(a.size, b.size)) }; };
export function mergeOverlappingRows(text: string): { text: string; merged: number } {
  let merged = 0;
  const result = text.replace(/(?:^\|.*\|[ \t]*(?:\n|$))+/gmu, block => {
    const lines = block.replace(/\n$/u, "").split("\n");
    if (lines.length < 4 || !/^\|\s*:?-{2,}/u.test(lines[1])) return block;
    const rows = lines.slice(2).map(line => line.replace(/^\||\|\s*$/gu, "").split("|").map(cell => cell.trim()));
    if (rows.some(row => row.length < 3 || row.length !== rows[0].length)) return block;
    const terms = rows.map(row => knowledgeTerms(row.slice(1).join(" ")));
    const into = rows.map((_, index) => index);
    for (let later = 1; later < rows.length; later++) for (let earlier = 0; earlier < later; earlier++) {
      if (into[earlier] !== earlier || NAMED.test(rows[earlier][0]) || NAMED.test(rows[later][0])) continue;
      const { shared, cover } = overlap(terms[earlier], terms[later]);
      if (shared >= ROW_SHARED && cover >= ROW_COVER) { into[later] = earlier; break; }
    }
    if (into.every((home, index) => home === index)) return block;
    const kept = rows.map((row, index) => ({ row: [...row], index })).filter(({ index }) => into[index] === index);
    for (const { row, index } of kept) {
      const joined = rows.filter((_, other) => other !== index && into[other] === index);
      if (!joined.length) continue;
      merged += joined.length;
      row[0] = [row[0], ...joined.map(other => other[0])].join("、");
      for (let column = 1; column < row.length; column++) for (const other of joined) {
        for (const clause of other[column].split(/(?<=[；;。])|[，,]/u).map(part => part.trim().replace(/[；;。]$/u, "")).filter(Boolean)) {
          const own = knowledgeTerms(clause), have = knowledgeTerms(row[column]);
          if (own.size && overlap(own, have).shared / own.size < NEW_CLAUSE) row[column] = `${row[column].replace(/[；;。]$/u, "")}；${clause}`;
        }
      }
    }
    return [lines[0], lines[1], ...kept.map(({ row }) => `| ${row.join(" | ")} |`)].join("\n") + (block.endsWith("\n") ? "\n" : "");
  });
  return { text: result, merged };
}

/** A clause refusing what it names ("禁止默认使用 localStorage", "绝不写入 localStorage"). */
const REFUSING = /不|禁止|严禁|勿|避免|无需|\b(?:never|avoid|not|no)\b/iu, TECH_NAME = /[A-Za-z][A-Za-z0-9]{3,}/gu;
/** Words telling a change in the earlier version's own paragraph: it already says which version holds. */
const TELLS_CHANGE = /此前|早期|最初|起初|后改|改为|改成|取代|替代|不再/u;
const named = (text: string, refusing: boolean) => new Set(text.split(/[，,；;。！!？?\n]/u).filter(clause => REFUSING.test(clause) === refusing).flatMap(clause => clause.match(TECH_NAME) ?? []).filter(name => !GENERIC_NAME.test(name)));
/** The mechanism one statement allows and the other refuses, if any. */
export function opposedMechanism(first: string, second: string): string | undefined {
  const pick = (a: string, b: string) => { const refusedHere = named(a, true), refusedThere = named(b, true); return [...named(a, false)].find(name => refusedThere.has(name) && !refusedHere.has(name)); };
  return pick(first, second) ?? pick(second, first);
}

/** Two versions of one point, the later said to replace the earlier with no word of the user's settling it, written in
 * two places as rules that hold now: "可选“在此设备记住”存 localStorage" in one chapter, "绝不写入 localStorage" in
 * another. Only a mechanism one allows and the other refuses is told: versions that add to each other both hold. The
 * order alone cannot say which holds (an assistant's later wording is no decision), so the earlier paragraph is noted
 * for the user to settle. Returns how many notes were added. */
export function versionDisagreements(chapters: WikiDraftChapter[], relations: Array<{ older: string; newer: string; kind: string; status: string }>, statementOf: (id: string) => string | undefined): number {
  const at = (id: string) => chapters.flatMap(chapter => chapter.paragraphs.filter(paragraph => paragraph.unitIds.includes(id)).map(paragraph => ({ chapter, paragraph })));
  let added = 0;
  const noted = new Set<string>();
  for (const relation of relations) {
    if (added >= MAX_NOTES) break;
    if (relation.status !== "unresolved" || relation.kind !== "replaces" && relation.kind !== "rejects") continue;
    const older = statementOf(relation.older), newer = statementOf(relation.newer);
    const mechanism = older && newer ? opposedMechanism(older, newer) : undefined;
    if (!older || !newer || !mechanism) continue;
    const earlier = at(relation.older), later = at(relation.newer);
    // Written together, the paragraph tells them apart itself.
    if (!earlier.length || !later.length || earlier.some(({ paragraph }) => paragraph.unitIds.includes(relation.newer))) continue;
    const { chapter, paragraph } = earlier[0], other = later[0];
    if (TELLS_CHANGE.test(paragraph.text) || noted.has(paragraph.text)) continue;
    noted.add(paragraph.text);
    const where = other.chapter === chapter ? "本章另一处" : `「${other.chapter.title}」中`;
    chapter.body = chapter.body.replace(paragraph.text, `${paragraph.text}\n\n> 版本未定：此处「${short(older)}」是较早的说法，${where}「${short(newer)}」是较晚的说法，对 ${mechanism} 一个允许、一个禁止。原文未见你确认改用哪一版，需要你确认。`);
    added++;
  }
  return added;
}
