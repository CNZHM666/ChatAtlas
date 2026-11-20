import { wikiStatementWithConditions, type WikiKnowledgeUnit } from "../shared/wiki-knowledge";
import { withStop } from "../shared/wiki-sentences";

const EXAMPLE_MAPPING = /[，,]\s*(?:例如|比如)\s*(?:将|把)\s*[“「"`]?([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)[”」"`]?\s*(?:映射(?:到|为)|转(?:化|换)为|改写为|提示为|对应)\s*[“「"]([^”」"\n]+)[”」"](?:的(?:建议|提示|文案))?|,\s*(?:for example\s*,?\s*(?:map|convert|translate)?\s*|e\.g\.\s*)[`"]?([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)[`"]?\s*(?:to|as|→)\s*["“]([^"”\n]+)["”]/u;
const comparable = (text: string) => text.normalize("NFKC").replace(/[\s*`"“”「」]/gu, "").toLowerCase();

/** A valid code and a valid remedy do not establish a mapping between them.
 * Check the nearest occurrence of the code in each quoted source. */
export function wikiWithoutUnsupportedExample(text: string, units: readonly WikiKnowledgeUnit[]) {
  const match = text.match(EXAMPLE_MAPPING);
  if (!match || match.index === undefined || !units.length || units.some(unit => unit.evidence.pasted)) return;
  const code = match[1] ?? match[3], action = comparable(match[2] ?? match[4]);
  const grounded = units.some(({evidence}) => evidence.quote.split(/(?<=[。！？])|\n\s*\n/u).some(fragment => {
    const at = fragment.indexOf(code);
    if (at < 0) return false;
    const after = fragment.slice(at + code.length, at + code.length + 120).split(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/u)[0];
    return comparable(after).includes(action);
  }));
  if (grounded) return;
  return withStop((text.slice(0, match.index) + text.slice(match.index + match[0].length)).trim());
}

const INTEGRATION_ASSERTION = /(?:已确认|已决定|已批准|确认|批准)(?:采用|实施|进行)?\s*(?:集成|接入)|\b(?:confirmed|approved)\s+(?:to\s+)?integrat/iu;

export function wikiIntegrationProposal(text: string, unit: WikiKnowledgeUnit, zh: boolean) {
  if (!INTEGRATION_ASSERTION.test(text) || unit.about || unit.evidence.pasted || unit.evidence.role !== "assistant") return;
  const statement = wikiStatementWithConditions(unit, zh).replace(/^(?:AI\s*)?(?:建议|提议)\s*[：:]?\s*|^(?:AI\s+)?(?:propose[sd]?|suggests?)\s*[: ]\s*/iu, "");
  if (INTEGRATION_ASSERTION.test(statement)) return;
  return withStop((zh ? "建议" : "Proposal: ") + statement);
}

/** A decision about the design does not certify implementation. Drop a
 * generated completion aside when every sentence source is still a proposal. */
export function wikiWithoutImplementationAside(text: string, units: readonly WikiKnowledgeUnit[]) {
  const aside = /[，,]\s*(?:这(?:一|项)?功能|该功能|该能力|这一点)已(?:在[^。！？\n，,]{1,22})?(?:确认实现|验证完成|实现并验证)(?=[。！？.!?]|$)/u;
  if (!aside.test(text) || !units.length || units.some(unit => unit.evidence.pasted || unit.evidence.role !== "assistant"
    || unit.kind === "report" || unit.delivery === "user_reported" || /(?:已(?:经|在)[^。！？\n]{0,25})?(?:实现完毕|已实现|已上线|已验证|确认实现|可实际运行)|\b(?:has shipped|implemented and verified)\b/iu.test(unit.evidence.quote))) return;
  return text.replace(aside, "");
}

/** A contrast in a design recommendation gives a preferred form and a form
 * to avoid. It does not establish that a previous implementation was replaced. */
export function wikiDesignContrast(text: string, unit: WikiKnowledgeUnit) {
  const claim = text.match(/^([^\n。！？]{2,30}?)应(?:改为|改用)([^\n。！？]+?)[，,]\s*(?:替代|取代)[^\n。！？]+[。.]?$/u);
  const quote = unit.evidence.quote.match(/不(?:是做成|要做成|应采用)\s*([^，,。\n]{2,50})[，,]\s*而是\s*([^。\n]{2,90})/u);
  if (!claim || !quote || unit.about || unit.evidence.pasted || unit.evidence.role !== "assistant") return;
  const extra = claim[2].match(/^(.+?)(并(?:附带|提供|展示).+)$/u);
  const preferred = extra?.[1] ?? claim[2], supplement = extra?.[2] ?? "";
  const shape = comparable(preferred).replace(/^(?:浅层|轻量|极简|简洁)(?=[A-Za-z])/iu, "").replace(/(?:样式|风格)$/u,"");
  if (shape.length < 3 || !comparable(quote[2]).includes(shape)) return;
  return withStop(`建议${claim[1]}采用${preferred}${supplement}，避免${quote[1].replace(/\*\*/gu,"").trim()}`);
}
