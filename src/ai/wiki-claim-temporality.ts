import { wikiSaidWhen } from "../shared/wiki-section-status";
import { wikiStatementWithConditions, type WikiKnowledgeUnit, type WikiUnitRelation } from "../shared/wiki-knowledge";
import { assertsWikiReplacement, wikiReplacementSupported } from "./wiki-version-conflict";

const SNAPSHOT = /^(?:\*\*)?(.{0,24}?)[ \t]*(?:截至当前[，,]?|当前(?:本轮)?|目前|现阶段|现在)\s*(?=(?:尚)?(?:不|未|只|仅|已|仍|缺|支持|使用|完成|项目已))|^(?:currently|as of now)\b\s*/iu;
const SNAPSHOT_CLAUSE = /[；;]\s*(?=(?:后续|未来|下一阶段|计划|拟|建议|next|planned?|propos(?:e|ed))\b|(?:后续|未来|下一阶段|计划|拟|建议))/iu;
const IMPLIED_REPLACEMENT = /^(?:此前|早期|早先|旧版)(?:版本中|方案中|曾)?[^\n]+[；;]\s*(?:\*\*)?(?:现行|当前)(?:流程|方案|策略|做法)(?:为|是|采用)|^earlier\b[^\n]+;\s*(?:the )?current (?:flow|plan|approach)\b/iu;
export const wikiTemporalCandidate = /当前|目前|现阶段|现在|现行|简化|取代|替代|改为|current|replac|supersed/iu;

/** A source describes its own discussion time. Only a sourced replacement
 * is allowed to turn a pair of claims into a history of supersession. */
export function wikiTemporalClaim(text: string, units: WikiKnowledgeUnit[], relations: readonly WikiUnitRelation[], zh: boolean): { text: string; restoredProposal?: boolean } | undefined {
  if (!units.length || units.some(unit => unit.evidence.pasted || unit.about)) return;
  const explicit = assertsWikiReplacement(text);
  const implied = IMPLIED_REPLACEMENT.test(text);
  if (units.length === 1 && (explicit && !wikiReplacementSupported(text, units, relations) || implied && !explicit)) {
    const unit = units[0];
    const statement = wikiStatementWithConditions(unit, zh);
    if (assertsWikiReplacement(statement)) return;
    const at = wikiSaidWhen(unit, zh);
    const prefix = unit.evidence.role === "assistant" ? (zh ? "讨论中的建议" : "Proposal from the discussion") : (zh ? "讨论中的用户表述" : "User statement from the discussion");
    const prohibition = implied && text.split(/[；;]/u)[0].match(/(?:但\s*)?((?:不要|不得|严禁|禁止)[^；;]+)$/u)?.[1];
    const exact = prohibition && unit.evidence.quote.includes(prohibition.replace(/[。.]$/u, "")) && !statement.includes(prohibition)
      ? `${statement.replace(/[。.]$/u, "")}。${prohibition.replace(/[。.]$/u, "")}。` : statement;
    return { text: zh ? `${prefix}${at ? `（${at}）` : ""}：${exact}` : `${prefix}${at ? ` (${at})` : ""}: ${exact}`, restoredProposal: unit.evidence.role === "assistant" };
  }
  const match = text.match(SNAPSHOT);
  if(!match&&!text.includes("\n")){
    const pieces=text.split(/(?<=[，,。；;])/u);
    if(pieces.length>1&&pieces.some(piece=>SNAPSHOT.test(piece.trimStart()))){
      const revised=pieces.map(piece=>SNAPSHOT.test(piece.trimStart())?piece.match(/^\s*/u)![0]+(wikiTemporalClaim(piece.trimStart(),units,relations,zh)?.text??piece.trimStart()):piece).join("");
      if(revised!==text)return {text:revised};
    }
  }
  if (!match || text.includes("\n")) return;
  const [state, ...plan] = text.split(SNAPSHOT_CLAUSE);
  const raw = state.replace(SNAPSHOT, (_all, subject: string | undefined) => subject ? `${subject.trim()} ` : "").trim();
  if (!raw || raw === state) return;
  const days = [...new Set(units.map(unit => wikiSaidWhen(unit, zh)).filter(Boolean))];
  const when = days.length === 1 ? days[0] : "";
  const label = units.every(unit => unit.evidence.role === "user") ? (zh ? "当时的用户报告" : "User report at the time") : (zh ? "讨论当时的状态描述" : "Status described at the time");
  const statement = zh ? `${label}${when ? `（${when}）` : ""}：${raw}` : `${label}${when ? ` (${when})` : ""}: ${raw}`;
  return { text: plan.length ? `${statement.replace(/[。.]$/u, "")}${zh ? "。后续建议：" : ". Follow-up proposal: "}${plan.join(zh ? "；" : "; ").replace(zh ? /^(?:计划|建议|拟)\s*/u : /^(?:plan(?:ned)? to|propose to)\s*/iu, "")}` : statement };
}
