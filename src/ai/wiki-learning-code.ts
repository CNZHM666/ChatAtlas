import type { CoverageMaterial } from "./focus-coverage";
import { wikiUnitId } from "./wiki-knowledge-units";
import { wikiLedgerUnits, type WikiKnowledgeLedger, type WikiKnowledgeUnit, type WikiUnitBatch } from "../shared/wiki-knowledge";

/** The batch holding the learner's code: read from the messages, not asked of the model, and kept by an update. */
export const LEARNER_CODE_BATCH = "learner-code";

const FENCE = /^[ \t]*(`{3,}|~{3,})[ \t]*([\w+#.-]*)[^\n]*\n([\s\S]*?)\n[ \t]*\1[ \t]*$/gmu;
/** A line of code a learner types without a fence: a definition, a loop or condition, a call, an assignment. */
const CODE_LINE = /^\s*(?:def\s+\w+\s*\(|class\s+\w+|for\s+\w+(?:\s*,\s*\w+)*\s+in\s+\S|while\s+.+:\s*$|(?:if|elif)\s+.+:\s*$|else\s*:\s*$|return\b|print\s*\(|import\s+\w|from\s+[\w.]+\s+import\s|try\s*:\s*$|except\b.*:\s*$|[A-Za-z_][\w.]*(?:\[[^\]\n]*\])*\s*(?:[+\-*/]?=)\s*[^=\s])/u;
const INDENTED = /^(?:\t| {2,})\S/u;
/** The AI saying the code that follows is the learner's: "第三题的问题在这里：", "你最后这一句：", "你的错误代码". */
const YOURS = /你(?:的|写的|这段|原来的|这里的|最后这一?句|这一?行|这样写|刚才)|第\s*[一二三四五六七八九十\d]+\s*题|\byour (?:code|answer|line|version)\b|\byou wrote\b/iu;
/** …unless it gives the AI's own version: "应该写成", "改成", "更准确应该是". */
const AI_VERSION = /应该|可以写|改成|改为|改正|修改后|改后|正确|更准确|推荐|建议|标准|示范|例如|比如|\b(?:should|instead|correct|fixed|better)\b/iu;
/** …or sets a task or a case to suppose: "如果第三题：" before `voltages = [2, 5, 12, 7]` gave the data of a task, not the
 * learner's answer. */
const SUPPOSED = /^(?:如果|假如|假设|要是|若|请|试着|接下来|下面|下一|练习|题目|任务|(?:if|suppose|say|try|given)\b)|(?:题目|数据|输入)(?:是|为|如下)/iu;
/** What the code is about, so the directory places it with the lesson it practises. */
const TOPICS: Array<[RegExp, string, string]> = [
  [/^\s*def\s/mu, "函数定义", "Functions"], [/^\s*class\s/mu, "类与对象", "Classes"], [/^\s*(?:try|except)\b/mu, "异常处理", "Exceptions"],
  [/^\s*(?:for|while)\s/mu, "for循环", "Loops"], [/^\s*(?:if|elif)\s/mu, "条件判断", "Conditions"], [/^\s*(?:import|from)\s/mu, "模块导入", "Imports"],
  [/\bf["']/u, "字符串格式化", "f-strings"], [/\{[^}\n]*:[^}\n]*\}|\[["'][^\]\n]*["']\]/u, "字典", "Dictionaries"], [/\[[^\]\n]*,[^\]\n]*\]|\.append\(/u, "列表", "Lists"],
];

interface Message { evidenceId: string; conversationId: string; messageId: string; messageIndex: number; role: "user" | "assistant"; text: string }

/** A learning record's exercises, read from the messages themselves: the code in the learner's own messages, fenced or
 * typed, and code the AI quotes back as theirs while marking it ("第三题的问题在这里：…"). Extraction reads for durable
 * knowledge and left every exercise out ("你的练习 0 条"); a message with a fence also read as pasted material. Each
 * becomes a unit of its own, its code as written. Added once: a unit already there is not added again. */
export function withLearnerCode(ledger: WikiKnowledgeLedger, materials: CoverageMaterial[], zh: boolean): WikiKnowledgeLedger {
  if (ledger.documentType !== "learning") return ledger;
  const known = new Set(wikiLedgerUnits(ledger).map(unit => unit.id)), seen = new Map<string, WikiKnowledgeUnit | undefined>(), units: WikiKnowledgeUnit[] = [];
  const messages = messagesOf(materials), tasks = new Map(messages.filter(message => message.role === "assistant").map(message => [message, setTasks(message.text)] as const).filter(([, set]) => set.size));
  for (const message of messages) {
    for (const found of message.role === "user" ? ownCode(message.text) : quotedCode(message.text)) {
      const task = taskOf(found, message, tasks);
      // The AI quoting back part of what the learner sent is the same exercise; its review is that exercise's.
      const key = found.code.text.replace(/\s+/gu, "");
      const same = [...seen].find(([other]) => other.includes(key) || key.includes(other));
      if (same) {
        const earlier = same[1];
        if (earlier && found.review && !earlier.evidence.review) earlier.evidence.review = found.review;
        if (earlier && task && !earlier.evidence.task) earlier.evidence.task = task;
        continue;
      }
      const topic = TOPICS.find(([test]) => test.test(found.code.text)), subject = topic ? zh ? topic[1] : topic[2] : zh ? "Python 练习" : "Python practice";
      const statement = found.said || (zh ? `你写的代码：${firstLine(found.code.text)}` : `Your code: ${firstLine(found.code.text)}`);
      const id = wikiUnitId(subject, message.conversationId, message.messageId, found.code.text, "learner-code");
      if (known.has(id)) { seen.set(key, undefined); continue; }
      const unit: WikiKnowledgeUnit = { id, subject, facet: zh ? "你的练习" : "Your exercise", statement, kind: "fact", details: [],
        evidence: { evidenceId: message.evidenceId, conversationId: message.conversationId, messageId: message.messageId, messageIndex: message.messageIndex, role: message.role, pasted: false, quote: found.quote, code: found.code, learnerCode: true, ...(found.review ? { review: found.review } : {}), ...(task ? { task } : {}) },
        adoption: { status: message.role === "user" ? "unknown" : "proposal" }, delivery: "unknown" };
      seen.set(key, unit);
      units.push(unit);
    }
  }
  if (!units.length) return ledger;
  const batch: WikiUnitBatch = { sourceIds: [...new Set(units.map(unit => unit.evidence.evidenceId))], signature: LEARNER_CODE_BATCH, status: "ok", units, rejected: {} } as WikiUnitBatch;
  return { ...ledger, batches: [...ledger.batches.filter(item => item.signature !== LEARNER_CODE_BATCH), ...ledger.batches.filter(item => item.signature === LEARNER_CODE_BATCH).map(item => ({ ...item, units: [...item.units, ...units] })), ...ledger.batches.some(item => item.signature === LEARNER_CODE_BATCH) ? [] : [batch]] };
}

/** An update keeps the learner's code read the first time: re-extraction asks the model only. */
export function keptLearnerCode(ledger: WikiKnowledgeLedger, earlier: WikiKnowledgeLedger | undefined): WikiKnowledgeLedger {
  const kept = earlier?.batches.find(batch => batch.signature === LEARNER_CODE_BATCH);
  return kept && !ledger.batches.some(batch => batch.signature === LEARNER_CODE_BATCH) ? { ...ledger, batches: [...ledger.batches, kept] } : ledger;
}

/** Whole messages from their materials: a long message is read in several parts. */
function messagesOf(materials: CoverageMaterial[]): Message[] {
  const byMessage = new Map<string, Message>();
  for (const material of materials) {
    const key = JSON.stringify([material.conversationId, material.messageId]), text = material.text.replace(/^(?:user|assistant|system|tool): /u, "");
    const known = byMessage.get(key);
    if (known) { known.text += `\n${text}`; continue; }
    byMessage.set(key, { evidenceId: material.id, conversationId: material.conversationId, messageId: material.messageId, messageIndex: material.messageIndex ?? -1, role: material.role === "user" ? "user" : "assistant", text });
  }
  return [...byMessage.values()];
}

type Task = NonNullable<WikiKnowledgeUnit["evidence"]["task"]>;
const NUMERALS = "一二三四五六七八九十";
const NUMBERED = /第\s*([一二三四五六七八九十]|\d{1,2})\s*题/gu;
const numberOf = (numeral: string) => /\d/u.test(numeral) ? Number(numeral) : NUMERALS.indexOf(numeral) + 1;
/** The exercise a text names last: "第三题的问题在这里" → 3. */
function exerciseNumber(text: string): number | undefined {
  const last = [...text.matchAll(NUMBERED)].at(-1);
  return last ? numberOf(last[1]) : undefined;
}
/** A line opening a task: "第三题，最重要：", "### 第一题", "**第二题**：写一个函数…"; never "第三题的问题在这里" (a review). */
const TASK_HEAD = /^(?:#{1,6}\s*)?(?:\*\*)?(?:练习\s*)?第\s*([一二三四五六七八九十]|\d{1,2})\s*题(?:\*\*)?(?:[，,：:\s]+(.*))?$/u;
/** A task's words ask for something to be done. */
const TASK_SAID = /输出|打印|写(?:一个|出|代码|程序)?|要求|规则|判断|定义|计算|返回|创建|修改|\b(?:print|write|return|output)\b/iu;
const TASK_CHARS = 160;
/** How to hand the answers in, not the task: "你自己写完发给我。", "如果这三题能独立写出来，这一课就算过关". */
const HANDING_IN = /发给我|发我|写完|写出来|过关|做完|做出来|\b(?:send (?:it|them|me)|when you're done)\b/iu;
/** The line before a block holding the rule. */
const RULE_LEAD = /(?:规则|要求|条件|判断标准)\s*[：:]$/u;
/** The tasks an AI message sets, by number: "第三题，最重要：" over its data (`voltage = 7`) and its rule ("> 如果电压在 3 到
 * 10 之间，输出 …"). A section holding code to read is a review or an example, not a task. */
export function setTasks(text: string): Map<number, Task> {
  const lines = text.split("\n"), heads: Array<{ at: number; n: number; rest: string }> = [];
  let fence = "";
  lines.forEach((line, at) => {
    const mark = line.match(/^\s*(`{3,}|~{3,})/u)?.[1];
    if (mark) { fence = !fence ? mark : mark.startsWith(fence) ? "" : fence; return; }
    const head = !fence && line.trim().match(TASK_HEAD);
    if (head) heads.push({ at, n: numberOf(head[1]), rest: head[2] ?? "" });
  });
  const tasks = new Map<number, Task>();
  heads.forEach((head, index) => {
    let end = heads[index + 1]?.at ?? lines.length;
    for (let at = head.at + 1; at < end; at++) if (/^\s*(?:#{1,6}\s|[-*_]{3,}\s*$)/u.test(lines[at])) { end = at; break; }
    const part = lines.slice(head.at + 1, end).join("\n"), fences = [...part.matchAll(FENCE)];
    if (fences.some(match => !dataOnly(match[3]) && worthShowing(match[3]))) return;
    const prose = [head.rest, ...part.replace(FENCE, "\n").split("\n")].map(line => line.trim()).filter(line => line && !HANDING_IN.test(line));
    const quoted = prose.filter(line => line.startsWith(">")).map(line => line.replace(/^>\s*/u, ""));
    // A rule given as a block under "规则：" (">= 30 Hot / >= 20 Normal / 其他 Cold"): its lines are the rule.
    const ruled = fences.find(match => !dataOnly(match[3]) && RULE_LEAD.test(part.slice(0, match.index).trimEnd().split("\n").at(-1) ?? ""));
    const rule = ruled ? ruled[3].split("\n").map(line => line.trim().replace(/\s{2,}/gu, " ")).filter(Boolean).join("；") : "";
    let said = (quoted.length ? quoted : rule ? [rule] : prose.filter(line => !/[：:]$/u.test(line))).join(" ").replace(/\*\*/gu, "").replace(/\s+/gu, " ").trim();
    if (!said || !rule && !TASK_SAID.test(said) || /你写的|你的(?:代码|答案)/u.test(said)) return;
    if (said.length > TASK_CHARS) said = `${said.slice(0, TASK_CHARS).replace(/[，,；;、\s][^，,；;、\s]*$/u, "")}…`;
    // Data is given as code: a text block of values ("name = \"Robot1\"" under "不要重新写三个变量") shows what not to write.
    const data = fences.find(match => dataOnly(match[3]) && /^(?:python|py)?$/iu.test(match[2]));
    if (!tasks.has(head.n)) tasks.set(head.n, { said, ...(data ? { code: { language: (data[2] || "python").toLowerCase(), text: data[3].replace(/\s+$/u, "") } } : {}) });
  });
  return tasks;
}
/** How far back a task is looked for: the AI sets it, the learner answers, the AI reviews. */
const TASK_LOOKBACK = 6;
/** The task an exercise answers: by its number ("第三题"), in the latest AI message before it setting that task; an
 * exercise named by no number answers the one task such a message sets, if it sets one only. */
function taskOf(found: Found, message: Message, tasks: Map<Message, Map<number, Task>>): Task | undefined {
  const before = message.role === "user" ? message.text.slice(0, Math.max(0, message.text.indexOf(found.quote))).slice(-80) : "";
  const n = exerciseNumber(found.said) ?? found.n ?? (message.role === "user" ? exerciseNumber(before) ?? ([...message.text.matchAll(NUMBERED)].length ? undefined : 0) : undefined);
  if (n === undefined) return found.asked ? { said: found.asked } : undefined;
  const earlier = [...tasks].filter(([other]) => other.conversationId === message.conversationId && other.messageIndex < message.messageIndex && other.messageIndex >= message.messageIndex - TASK_LOOKBACK)
    .sort((a, b) => b[0].messageIndex - a[0].messageIndex);
  // A task giving data the code never names was set for another lesson: "第二题" of the list lesson is not the second
  // task of the lesson before, whose data was `temperature` and `pressure`.
  const fits = (task: Task) => !task.code || [...task.code.text.matchAll(/^\s*([A-Za-z_]\w*)\s*=/gmu)].some(name => new RegExp(`\\b${name[1]}\\b`, "u").test(found.code.text));
  for (const [, set] of earlier) {
    if (n && set.has(n)) { const task = set.get(n)!; if (fits(task)) return task; break; }
    if (!n) return set.size === 1 ? [...set.values()][0] : found.asked ? { said: found.asked } : undefined;
  }
  return found.asked ? { said: found.asked } : undefined;
}

/** n: the number named on the line before the AI's cue ("第三题逻辑基本对，…细节：" over "你写的是："). asked: the task as
 * the AI recalled it in its review ("我原来的要求是：" over its rule). */
interface Found { code: { language: string; text: string }; said: string; quote: string; review?: Review; n?: number; asked?: string }
interface Review { said: string; code?: { language: string; text: string }; shows?: { language: string; text: string }; asked?: string }
/** The line before a block recalling the task: "我原来的要求是：", "题目要求是：" — not "规则：" under a new one set for
 * tomorrow ("自己写一个：规则："). */
const ASKED_LEAD = /(?:原来的?|之前的?|原题|题目的?|我的)\s*(?:要求|规则)(?:是|为)?\s*[：:]$/u;
const REVIEW_CHARS = 240, SHOWS_LINES = 12;

/** What the AI says of an exercise right after quoting it: its words up to its own version of the code ("应该写成：…"),
 * the next exercise or the next heading; the code it gives instead; and one block its words lead into ("这样不行，因为：",
 * "我原来的要求是："), which stopped the verdict short of its reason when only the words before it were read. */
function reviewAfter(text: string, end: number, next: number): Review | undefined {
  const rest = text.slice(end, next), prose: string[] = [];
  const lines = (part: string) => part.split("\n").map(line => line.trim()).filter(line => line && !/^(?:[-*_]{3,}|#{1,6}\s)/u.test(line));
  let at = 0, code: Review["code"], shows: Review["shows"], asked: string | undefined;
  for (const fence of rest.matchAll(FENCE)) {
    const before = lines(rest.slice(at, fence.index));
    at = fence.index! + fence[0].length;
    const lead = before.at(-1) ?? "", block = { language: (fence[2] || "python").toLowerCase(), text: fence[3].replace(/\s+$/u, "") };
    // The line leading the AI's version is its caption, not part of the verdict; the verdict ends there.
    if (lead && AI_VERSION.test(lead) && lead.length <= 40 && worthShowing(fence[3])) { prose.push(...before.slice(0, -1)); code = block; break; }
    // The task recalled as a rule ("我原来的要求是：" over "voltage > 10 → High …"): the exercise's task, not a remark.
    if (!asked && lead.length <= 40 && ASKED_LEAD.test(lead) && !/^(?:python|py)$/iu.test(fence[2]) && !worthShowing(fence[3])) {
      prose.push(...before.slice(0, -1));
      asked = block.text.split("\n").map(line => line.trim().replace(/\s{2,}/gu, " ")).filter(Boolean).join("；");
      continue;
    }
    prose.push(...before);
    if (!shows && /[：:]$/u.test(lead) && block.text.split("\n").length <= SHOWS_LINES) shows = block;
  }
  if (!code) prose.push(...lines(rest.slice(at)));
  let said = prose.join(" ").replace(/\s+/gu, " ").trim();
  if (said.length > REVIEW_CHARS) said = `${said.slice(0, REVIEW_CHARS).replace(/[，,；;、\s][^，,；;、\s]*$/u, "")}…`;
  return said || code || asked ? { said, ...(code ? { code } : {}), ...(shows ? { shows } : {}), ...(asked ? { asked } : {}) } : undefined;
}

/** The learner's code: each fence, else the longest run of typed code lines (two at least). said is their words beside
 * it ("第三题我这样写对吗"), cut to one sentence. */
export function ownCode(text: string): Found[] {
  const fences = [...text.matchAll(FENCE)].filter(match => match[3].trim() && worthShowing(match[3]));
  const words = (rest: string) => rest.replace(/\s+/gu, " ").trim().match(/^.{2,60}?(?:[。！？!?]|$)/u)?.[0].trim() ?? "";
  if (fences.length) {
    const rest = text.replace(FENCE, " ");
    return fences.map(match => ({ code: { language: (match[2] || "python").toLowerCase(), text: match[3].replace(/\s+$/u, "") }, said: words(rest), quote: match[0].trim() }));
  }
  const lines = text.split("\n");
  let best: [number, number] | undefined, start = -1, count = 0;
  const close = (end: number) => { if (start >= 0 && count >= 2 && (!best || end - start > best[1] - best[0])) best = [start, end]; start = -1; count = 0; };
  lines.forEach((line, index) => {
    if (CODE_LINE.test(line)) { if (start < 0) start = index; count++; }
    else if (start >= 0 && (INDENTED.test(line) || !line.trim() && CODE_LINE.test(lines[index + 1] ?? "") || !line.trim() && INDENTED.test(lines[index + 1] ?? ""))) { /* the block goes on */ }
    else close(index);
  });
  close(lines.length);
  if (!best) return [];
  const code = lines.slice(best[0], best[1]).join("\n").replace(/\s+$/u, "");
  if (!worthShowing(code)) return [];
  return [{ code: { language: "python", text: code }, said: words([...lines.slice(0, best[0]), ...lines.slice(best[1])].join(" ")), quote: code }];
}

/** Code the AI quotes back as the learner's: a fence right after words saying so, not one giving the AI's own version. */
export function quotedCode(text: string): Found[] {
  const marked = [...text.matchAll(FENCE)].flatMap(match => {
    const before = text.slice(0, match.index).trimEnd(), lead = before.split("\n").at(-1)?.trim() ?? "";
    if (!lead || lead.length > 80 || !YOURS.test(lead) || AI_VERSION.test(lead) || SUPPOSED.test(lead) || dataOnly(match[3]) || !worthShowing(match[3])) return [];
    // A cue naming no exercise ("你写的是：") under a line naming one ("第三题逻辑基本对，但有一个细节："): that line opens
    // this exercise, its number and the first words of its review, not the end of the one before.
    const above = before.slice(0, before.length - lead.length).trimEnd(), line = above.split("\n").at(-1)?.trim() ?? "";
    const opens = !exerciseNumber(lead) && line.length <= 120 && !/^(?:`{3,}|~{3,})/u.test(line) && exerciseNumber(line) !== undefined;
    // Of "可以，你这三题整体做得不错。第一题、第三题都对；第二题有一个小拼写错误：", the clause naming this one.
    const opener = opens ? line.split(/(?<=[。；;！？!?])/u).map(part => part.trim()).filter(part => exerciseNumber(part) !== undefined).at(-1) : undefined;
    return [{ match, lead, start: opens ? above.length - line.length : before.length - lead.length, ...(opener ? { opener } : {}) }];
  });
  // Each exercise's review runs to the next one, or to the next heading.
  return marked.map(({ match, lead, opener }, index) => {
    const end = match.index! + match[0].length, heading = text.slice(end).search(/\n#{1,6}\s/u);
    const next = Math.min(marked[index + 1]?.start ?? text.length, heading >= 0 ? end + heading : text.length);
    const found = reviewAfter(text, end, next), { asked, ...rest } = found ?? { said: "" };
    const said = [opener, rest.said].filter(Boolean).join(" ");
    const review = found && (said || rest.code) ? { ...rest, said } : undefined;
    return { code: { language: (match[2] || "python").toLowerCase(), text: match[3].replace(/\s+$/u, "") }, said: lead.replace(/[：:]\s*$/u, ""), quote: `${lead}\n${match[0].trim()}`,
      ...(review ? { review } : {}), ...(opener ? { n: exerciseNumber(opener) } : {}), ...(asked ? { asked } : {}) };
  });
}

/** Values set and nothing done with them: "第二题：" over `temperature = 35`, or `age = 20` and `has_ticket = True`, was
 * the data of a task the AI set, not an answer the learner sent. */
const DATA_LINE = /^\s*[A-Za-z_]\w*\s*=\s*(?:-?\d+(?:\.\d+)?|True|False|None|"[^"\n]*"|'[^'\n]*'|\[[^\]\n]*\]|\{[^}\n]*\})\s*(?:#.*)?$/u;
function dataOnly(code: string): boolean {
  const lines = code.split("\n").filter(line => line.trim());
  return lines.length > 0 && lines.every(line => DATA_LINE.test(line));
}

/** Code worth showing as an exercise: a statement, not an output ("Normal", "[1, 2, 3]") or a lone name. */
function worthShowing(code: string): boolean {
  const lines = code.split("\n").filter(line => line.trim());
  return lines.some(line => CODE_LINE.test(line) || /\w\s*\(/u.test(line)) && (lines.length >= 2 || code.trim().length >= 12);
}
const firstLine = (code: string) => (code.split("\n").find(line => line.trim()) ?? "").trim().slice(0, 60);
