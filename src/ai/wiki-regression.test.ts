import { afterEach, describe, expect, it } from "vitest";
import { ledgerDocument, setLedgerPassProbe } from "./wiki-ledger-document";
import { resolveWikiReading } from "./wiki-knowledge-reading";
import type { WikiKnowledgeLedger } from "../shared/wiki-knowledge";
import { figuresIn } from "../shared/wiki-figures";

// Breaks a text edit leaves behind, whatever the edit was: a clause that leaned on a sentence now gone, punctuation
// meeting where a clause was cut, a date with nothing it dates, a bold marker left open. The projection passes edit the
// writer's text one after another; these are checked after each pass on the regression samples, so a break is traced
// to the pass that made it instead of being found in the exported document.

const LIST_LEAD = /^\s*(?:[-*+]|\d+[.)])\s+(?:\*\*[^*\n]+\*\*\s*[：:]\s*)?/u;
/** A clause that only reads after another one: at the start of a paragraph or item, the one it leaned on is gone. */
const LEANING_START = /^(?:随后|而非|而不是|而是|从而|以便|以免|否则|进而|其中|并且|且(?![体慢])|，|、|；)/u;
const PUNCTUATION_MET = /[，、；：,][。！？；]|[。！？][，、；]|。。|，，|（\s*）|\*\*\s*\*\*/u;
/** A date annotation right after punctuation or at the start: the figure or event it dated was cut away. */
const ORPHAN_DATE = /(?:^|[，。；：、])\s*[（(]\d{1,2}月\d{1,2}日/u;

function textBreaks(body: string): string[] {
  const issues: string[] = [];
  let fenced = false;
  for (const raw of body.split("\n")) {
    if (/^\s*```/u.test(raw)) { fenced = !fenced; continue; }
    const line = raw.trim();
    if (fenced || !line || line.startsWith("#") || line.startsWith("|")) continue;
    const content = line.replace(/^>\s*/u, "").replace(LIST_LEAD, "");
    if (/^\s*(?:[-*+]|\d+[.)])\s+(?:\*\*[^*\n]+\*\*\s*[：:]?\s*)?$/u.test(raw)) issues.push(`empty item「${line}」`);
    else if (LEANING_START.test(content)) issues.push(`leaning start「${content.slice(0, 30)}」`);
    if (PUNCTUATION_MET.test(line)) issues.push(`punctuation met「${line.match(PUNCTUATION_MET)![0]}」in「${line.slice(0, 30)}」`);
    if (ORPHAN_DATE.test(line)) issues.push(`orphan date in「${line.slice(0, 30)}」`);
    if ((line.match(/\*\*/gu)?.length ?? 0) % 2) issues.push(`open bold in「${line.slice(0, 30)}」`);
  }
  return issues;
}

// Real ledgers frozen as regression samples. They hold the user's own conversations, so they stay in a git-ignored
// folder (evaluation/**/exports/) and this suite runs only where they are present.
// Node's modules are loaded by name, as the other file-reading tests do: the type check has no Node types.
const moduleName = "node:fs";
const { existsSync, readdirSync, readFileSync } = await import(/* @vite-ignore */ moduleName) as { existsSync: (path: string) => boolean; readdirSync: (path: string) => string[]; readFileSync: (path: string, encoding: "utf8") => string };
const DIR = "evaluation/regression/exports";
const samples = existsSync(DIR) ? readdirSync(DIR).filter(name => name.endsWith("-ledger.json")) : [];
type Chapters = NonNullable<WikiKnowledgeLedger["draft"]>["chapters"];

/** What every text line of the chapters breaks, one entry per break, so a pass is charged only with what it adds. */
const breaksOf = (chapters: Chapters) => chapters.flatMap(chapter => textBreaks(chapter.body).map(issue => `${chapter.title}: ${issue}`));
/** Units cited anywhere in the chapters: a confirmed decision must stay cited somewhere in the document. */
const cited = (chapters: Chapters) => new Set(chapters.flatMap(chapter => [...chapter.openingUnitIds ?? [], ...chapter.paragraphs.flatMap(paragraph => [...paragraph.unitIds, ...(paragraph.claims ?? []).flatMap(claim => claim.unitIds)])]));

afterEach(() => setLedgerPassProbe(undefined));

describe.skipIf(!samples.length)("projection regression samples", () => {
  for (const name of samples) it(`${name}: no pass breaks a sentence or drops a confirmed decision`, () => {
    const ledger = (JSON.parse(readFileSync(`${DIR}/${name}`, "utf8")) as { ledger: WikiKnowledgeLedger }).ledger;
    const { statuses } = resolveWikiReading(ledger);
    const confirmed = new Set([...statuses].filter(([, status]) => status === "confirmed").map(([id]) => id));
    // A pass is charged with a break only when the break is still there at the end: later passes may tidy what an
    // earlier one left (an emptied item, a cut clause), and that is how the chain is meant to work.
    const madeBy = new Map<string, string>(), dropped: string[] = [];
    let last: Chapters = [], passes = 0;
    setLedgerPassProbe((pass, before, after) => {
      passes++;
      const had = new Set(breaksOf(before));
      for (const issue of breaksOf(after)) if (!had.has(issue) && !madeBy.has(issue)) madeBy.set(issue, pass);
      const kept = cited(after);
      for (const id of cited(before)) if (confirmed.has(id) && !kept.has(id)) dropped.push(`${pass} → dropped confirmed ${id}`);
      last = after;
    });
    ledgerDocument(ledger, {});
    expect(passes).toBeGreaterThan(60);
    expect(dropped).toEqual([]);
    expect(breaksOf(last).map(issue => `${madeBy.get(issue) ?? "writer draft"} → ${issue}`)).toEqual([]);
  }, 180_000);

  // What a reader takes for fact, checked against the ledger rather than the text's shape. Written apart from the passes
  // fixing them, so a pass that stops working is caught here.
  for (const name of samples) it(`${name}: no figure misread as current, as the user's, or as one version`, () => {
    const ledger = (JSON.parse(readFileSync(`${DIR}/${name}`, "utf8")) as { ledger: WikiKnowledgeLedger }).ledger;
    const { units } = resolveWikiReading(ledger);
    const sections = ledgerDocument(ledger, {}).sections;
    expect(misreadings(sections.map(section => ({ title: section.title, body: section.body })), units)).toEqual([]);
  }, 180_000);
});

type Unit = ReturnType<typeof resolveWikiReading>["units"][number];
/** A table whose rows all share their first cell (versions of one measure with no time to tell them apart), 当前 before a
 * figure only an older report of the user's gives, a figure beside the user's own measure that the user never gave, and
 * one paragraph rejecting one plan after another sentence by sentence. */
function misreadings(sections: Array<{ title: string; body: string }>, units: Unit[]): string[] {
  const userUnits = units.filter(unit => unit.evidence.role === "user");
  const given = new Set(userUnits.flatMap(unit => figuresIn(`${unit.statement} ${unit.evidence.quote}`, { counts: true })));
  // The newest figure the user reported, not their newest message: a later conversation with no figure in it made the
  // August DAU of 40 read as older than 「now」.
  const reports = userUnits.filter(unit => /日活|DAU|留存|用户|付费/u.test(unit.statement) && figuresIn(unit.statement, { counts: true }).length > 0);
  const starts = reports.map(unit => unit.evidence.conversationSpan?.start ?? 0).filter(Boolean), newest = starts.length ? Math.max(...starts) : 0;
  const issues: string[] = [];
  /** Figures a unit gives with 万, 千 or 亿, which the document must not give bare: 「约2.88万条评价」 told as 「约 2.88 条」. */
  const magnitudes = [...new Map(units.flatMap(unit => [...unit.statement.matchAll(/(\d+(?:\.\d+)?)\s*(万|千|亿)/gu)].map(match => [match[1], match[2]] as const))).entries()];
  for (const { title, body } of sections) {
    const lines = body.split("\n");
    for (let at = 0; at + 3 < lines.length + 1; at++) {
      if (!/^\|/u.test(lines[at]) || !/^\|\s*:?-{3,}/u.test(lines[at + 1] ?? "")) continue;
      const rows: string[] = [];
      for (let next = at + 2; next < lines.length && /^\|/u.test(lines[next]); next++) rows.push(lines[next].split("|")[1].replace(/\*\*/gu, "").trim());
      if (rows.length >= 2 && new Set(rows).size === 1) issues.push(`${title}: rows all named「${rows[0]}」with no time`);
      if (rows.length === 1 && /时间|日期|时期|阶段|版本/u.test(lines[at].split("|")[1] ?? "")) issues.push(`${title}: a table of one version「${rows[0]}」`);
    }
    for (const line of lines) {
      if (/^\s*(?:\||```|#)/u.test(line)) continue;
      for (const match of line.matchAll(/(?:当前|目前|现在)(?:[^，。；\d]{0,10}?)(日活|DAU)[^，。；\d]{0,6}?(\d+)/gu)) {
        const givers = userUnits.filter(unit => [...unit.statement.matchAll(/\d+/gu)].some(figure => figure[0] === match[2]));
        if (givers.length && givers.every(unit => (unit.evidence.conversationSpan?.start ?? 0) < newest)) issues.push(`${title}: 「${match[0]}」 calls an older figure current`);
      }
      for (const match of line.matchAll(/(?:日活|DAU)\s*(?:约|仅|为|在|卡在|稳定在)?\s*(\d+)|(\d+)\s*人?\s*日活/gu)) {
        const clause = line.slice(Math.max(0, (match.index ?? 0) - 12), (match.index ?? 0) + match[0].length + 8);
        if (!/目标|提升|突破|达到|达成|实现|超|以上|争取|计划|≥|稳定超/u.test(clause) && !given.has(match[1] ?? match[2])) issues.push(`${title}: 「${match[0]}」 gives a figure the user never reported`);
      }
      if ((line.match(/你否定了/gu)?.length ?? 0) >= 2) issues.push(`${title}: rejections told sentence by sentence「${line.slice(0, 24)}」`);
      for (const sentence of line.replace(/^\s*(?:[-*+]|\d+\.)\s+/u, "").split(/(?<=[。！？])/u)) {
        if (/^[^，。；]{0,24}?(?:(?:经过|历经)了?(?:多轮|多次|反复)|(?:有所|几经)(?:调整|变化|优化)|存在不同(?:阶段)?的?(?:方案|版本))[^，；]*[。！？]?$/u.test(sentence.trim())) issues.push(`${title}: 「${sentence.trim()}」 tells only that something changed`);
      }
      if (/此前(?:建议|曾)?(?:随后|之后|后来|进一步)/u.test(line)) issues.push(`${title}: a follow-on told as its own earlier point「${line.slice(0, 24)}」`);
      if (/[（(](?:已|被你?)否定[）)]/u.test(line)) issues.push(`${title}: a rejection told by a bracket「${line.slice(0, 24)}」`);
      if (/^\s*[-*+]\s+\*\*[^*\n]+\*\*[：:]\s*(?:此前建议)?(?:负责|内容|说明|描述)[：:]/u.test(line)) issues.push(`${title}: a table header left as a field「${line.slice(0, 24)}」`);
    }
    // Table rows too: 「| Brainbuddy | … | 约 2.88 条评价 |」 was a cell.
    for (const line of lines) {
      if (/^\s*```/u.test(line)) continue;
      for (const [figure, magnitude] of magnitudes) {
        const value = figure.replace(".", "\\.");
        if (!new RegExp(`(?<![\\d.])${value}\\s*(?:条|次|名|个|用户|人)`, "u").test(line) || units.some(unit => new RegExp(`(?<![\\d.])${value}(?![\\d.]|\\s*[万千亿])`, "u").test(unit.statement))) continue;
        issues.push(`${title}: 「${figure}」 lost its ${magnitude}`);
      }
    }
    const questions = [...body.matchAll(/版本未定[ ·：:]+(「[^」]+」的[^：:\n]{1,6})[：:]?/gu)].map(match => match[1]);
    for (const question of new Set(questions.filter((item, at) => questions.indexOf(item) !== at))) issues.push(`${title}: the open question ${question} asked twice`);
  }
  return issues;
}

it("finds what a cut leaves behind: a leaning clause, a date with nothing it dates, punctuation met, an open bold", () => {
  expect(textBreaks("- 其中15个为稳定用户。")).toEqual([expect.stringContaining("leaning start")]);
  expect(textBreaks("此前报告，（6月14日—7月7日）付费率较低。")).toEqual([expect.stringContaining("orphan date")]);
  expect(textBreaks("日活约40，。")).toEqual([expect.stringContaining("punctuation met")]);
  expect(textBreaks("- **坚持数据：顶部指标改为连续天数。")).toEqual([expect.stringContaining("open bold")]);
  expect(textBreaks("- **任务**：")).toEqual([expect.stringContaining("empty item")]);
});

it("leaves whole sentences, code calls and tables alone", () => {
  expect(textBreaks("日活约40（8月18日），付费率较低。\n\nappend() 用于添加单个元素。\n\n| 其中 | 。。 |\n\n```\n，。\n```")).toEqual([]);
});
