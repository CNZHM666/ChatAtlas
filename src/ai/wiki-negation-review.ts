import { knowledgeTerms } from "../shared/knowledge-subject";
import { NEGATION, type WikiDraftClaim, type WikiKnowledgeUnit } from "../shared/wiki-knowledge";
import { wikiDocumentBlocks } from "../shared/wiki-document-blocks";
import { tableCells } from "../shared/wiki-body-text";

const bare = (text: string) => text.replace(/[\s，,。．.；;：:！!？?、“”"'‘’（）()]/gu, "");
const RULED_OUT = new RegExp(`${NEGATION.source}|\\b(?:zero|none|exclud\\w*|out of scope|outside|ruled out|rather than|instead of)\\b|排除|暂缓|放弃|取消|移除|去掉|拒绝|不含|而非|代替|替代|以免|防止`, "iu");
const PROHIBITION = /禁止|严禁|不得|不允许|\b(?:forbid\w*|prohibit\w*|must not)\b/iu;
const PREVENTS = /阻止|拦截|阻止其|\b(?:prevent\w*|block\w*|disallow\w*)\b/iu;
const ALLOWS_PREVENTED_ACTION = /(?:并?不|不会|不会再|未|无须|没有)(?:再|去)?(?:阻止|拦截)|\b(?:not|never|without)\s+(?:prevent\w*|block\w*|disallow\w*)\b/iu;
// An English full stop ends a clause too: "V1 is web-only. Native iOS or Android apps, …" is two, and a source clause
// is restored without its stop ("no native iOS or Android apps., receipt OCR" read in one export).
const ENGLISH_STOP = /(?<=[A-Za-z0-9)\]"'’*%`])(?<!\b(?:e\.g|i\.e|vs|etc|incl|approx|cf))\.(?=\s|$)/u;
const clausesOf = (text: string) => text.split(new RegExp(`[，,；;。！？!?\\n]|${ENGLISH_STOP.source}`, "u")).map(clause => clause.trim()).filter(Boolean);
/** The clauses of each sentence in turn. */
const sentenceClauses = (text: string) => text.split(new RegExp(`(?<=[。！？!?\\n])|${ENGLISH_STOP.source}`, "u")).map(clausesOf).filter(clauses => clauses.length);
const QUOTE = /“([^”\n]*)”|「([^」\n]*)」|"([^"\n]*)"/gu;
const CHOICE_LABEL = /^(?:是|否|我?有|我?没有|无|未知|不确定|未确定|已完成|未完成|yes|no|unknown|unsure|not sure|done|not done)$/iu;

/** Built-in response labels and example commands describe input, not what the product rules out. */
function withoutQuotedExamples(text: string) {
  return text.replace(/((?:支持|执行|识别|处理|示例指令|示例输入|\b(?:supports?|handles?|command|example input)\b)\s*[:：]?\s*)[“"「][^”"」\n]+[”"」]/giu, "$1")
    .replace(QUOTE, (quote, curly, corner, straight) => {
      const labels = (curly ?? corner ?? straight).split(/\s*[/／、,，]\s*/u);
      return labels.length > 1 && labels.every((label: string) => CHOICE_LABEL.test(label.trim())) ? "" : quote;
    });
}

const withoutQuotes = (text: string) => text.replace(QUOTE, "");
/** Latin names in a text, lowercased, without the words that name no option (AI, LLM, the product itself). */
const latinNames = (text: string) => (text.toLowerCase().match(/[a-z][a-z0-9.+#-]*/gu) ?? []).map(word => word.replace(/[.#-]+$/u, "")).filter(word => word.length > 1 && !["ai", "llm", "api", "app", "atlas", "chatatlas"].includes(word));
/** A clause the paragraph turned around: a cited unit rules something out ("避免使用 margin-left 平移页面"), and the
 * paragraph names the same thing (its Latin names and most of its words) in a clause with no negation of its own
 * or in the clause before it ("或通过 margin-left 平移页面"). The reader then takes what was ruled out as an option. */
export function lostNegation(text: string, statements: string[]): { clause: string; source: string } | undefined {
  const sentences = sentenceClauses(withoutQuotes(text));
  for (const statement of statements) for (const source of clausesOf(withoutQuotedExamples(statement))) for (const clauses of sentences) {
    const at = source.search(NEGATION);
    if (at < 0) continue;
    const object = source.slice(at).replace(NEGATION, ""), names = latinNames(object), terms = knowledgeTerms(object);
    if (!names.length && terms.size < 4) continue;
    for (const [index, clause] of clauses.entries()) {
      const own = knowledgeTerms(clause), shared = [...terms].filter(term => own.has(term)).length, lower = clause.toLowerCase();
      const same = names.length ? names.every(name => lower.includes(name)) && shared >= Math.min(3, terms.size) : shared >= 4 && shared / terms.size >= .7;
      if (same && PROHIBITION.test(source) && ALLOWS_PREVENTED_ACTION.test(clause)) return { clause, source };
      if (same && PROHIBITION.test(source) && PREVENTS.test(clause)) continue;
      // An item of a list the sentence rules out at its end ("native iOS or Android apps, bank syncing, … are excluded")
      // keeps its negation.
      const ruledOutAfter = clauses.slice(index + 1).some(other => RULED_OUT.test(other));
      if (same && !RULED_OUT.test(clause) && !RULED_OUT.test(clauses[index - 1] ?? "") && !ruledOutAfter) {
        if (/^(?:检查|检测|校验|验证|\b(?:check|validate|detect)\b)/iu.test(clause) && bare(text).includes(bare(source))) continue;
        return { clause, source };
      }
    }
  }
  return undefined;
}

const EXCLUSIVE = /仅在|只在|才(?:会|能)?显示|\bonly (?:in|under|when)\b/iu;
const SOURCE_MODE = /^(.{2,40}?)(?:模式|视图|场景)(?:下|中)?|^(.{2,40}?\b(?:mode|view))\b/iu;
const key = (value: string) => bare(value.normalize("NFKC").replace(/\*\*|__|`/gu, "")).toLowerCase();

/** A paired constraint can be written across two rows of one comparison.
 * Both rows must cite the same source and the negative row must name the
 * scope of that source's negative clause. */
export function tableNegationCovered(table: string, issue: { clause: string; source: string }, claims: readonly WikiDraftClaim[], units: ReadonlyMap<string, WikiKnowledgeUnit>) {
  if (!EXCLUSIVE.test(issue.clause)) return false;
  const rows = table.split("\n").slice(2).map(tableCells);
  const matches = rows.filter(row => row.some(cell => key(cell).includes(key(issue.clause))));
  if (matches.length !== 1) return false;
  const positive = matches[0], source = key(issue.source);
  const bound = (row: string[]) => new Set(claims.filter(claim => row.slice(1).some(cell => key(cell) === key(claim.text))).flatMap(claim => claim.unitIds));
  const object = knowledgeTerms(issue.source.slice(issue.source.search(NEGATION)).replace(NEGATION, ""));
  if (object.size < 2) return false;
  return rows.some(row => {
    if (row === positive || !row[0] || key(row[0]) === key(positive[0])) return false;
    const negative = row.slice(1).flatMap(clausesOf).some(clause => {
      if (!RULED_OUT.test(clause)) return false;
      const terms = knowledgeTerms(clause);
      return [...object].filter(term => terms.has(term)).length / object.size >= .7;
    });
    if (!negative || lostNegation(row.join("，"), [issue.source])) return false;
    const other = bound(row);
    return [...bound(positive)].some(id => {
      const unit = units.get(id);
      if (!unit || !other.has(id)) return false;
      return clausesOf(unit.statement).some(clause => {
        const scope = clause.match(SOURCE_MODE)?.[0]?.replace(/[下中]$/u, "");
        return Boolean(scope && key(row[0]) === key(scope) && key(clause).includes(source));
      });
    });
  });
}

export function recheckWikiTableNegation(problem: string, body: string, claims: readonly WikiDraftClaim[], units: ReadonlyMap<string, WikiKnowledgeUnit>) {
  const saved = problem.match(/^"(.+?)…" drops the negation of "(.+?)…"/u);
  if (!saved) return false;
  const issues = [...new Set(claims.flatMap(claim => claim.unitIds))].flatMap(id => {
    const unit = units.get(id);
    return unit ? clausesOf(unit.statement).filter(clause => key(clause).startsWith(key(saved[2]))) : [];
  });
  const affected = claims.filter(claim => body.includes(claim.text) && [claim.text, withoutQuotes(claim.text)]
    .some(text => clausesOf(text).some(clause => key(clause).startsWith(key(saved[1])))));
  if (affected.length && affected.every(claim => {
    const statements = claim.unitIds.flatMap(id => units.get(id)?.statement ?? []);
    const matches = (clause: string) => key(clause).startsWith(key(saved[2]));
    return statements.some(statement => clausesOf(statement).some(matches))
      && !statements.some(statement => clausesOf(withoutQuotedExamples(statement)).some(matches))
      && !lostNegation(claim.text, statements);
  })) return true;
  const equivalent = claims.some(claim => body.includes(claim.text) && clausesOf(claim.text).some(clause => key(clause).startsWith(key(saved[1]))
    && PREVENTS.test(clause) && !ALLOWS_PREVENTED_ACTION.test(clause) && claim.unitIds.some(id => {
      const unit = units.get(id);
      return unit && clausesOf(unit.statement).some(source => key(source).startsWith(key(saved[2])) && PROHIBITION.test(source) && !lostNegation(clause, [source]));
    })));
  if (equivalent) return true;
  return wikiDocumentBlocks(body).some(block => {
    if (block.kind !== "table") return false;
    return block.text.split("\n").slice(2).flatMap(tableCells).flatMap(clausesOf)
      .some(clause => key(clause).startsWith(key(saved[1])) && issues.some(source => tableNegationCovered(block.text, { clause, source }, claims, units)));
  });
}
