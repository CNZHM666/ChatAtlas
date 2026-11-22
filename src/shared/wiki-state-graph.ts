import type { WikiClaim } from "./wiki-claims";
import { wikiLiteralText } from "./wiki-plain-block";
import { knowledgeScopesAgree, knowledgeStage } from "./knowledge-subject";

type Transition = { from: string; to: string; condition?: string; branch: boolean };
export type WikiStateEdge = Transition & { claim: WikiClaim };
const ARROW = /^([a-z][\w-]{0,31}|[\p{Script=Han}]{2,12})\s*(?:→|->)\s*([a-z][\w-]{0,31}|[\p{Script=Han}]{2,12})(?:\s*[（(]([^()（）\n]{2,80})[）)])?[。.]?$/iu;
const ACTION = /升级(?:为|到)|降级(?:为|到)|回退(?:至|到)|返回(?:至|到)?|切换(?:至|到|为)|\b(?:escalates? to|returns? to|falls? back to|switches? to)\b/iu;
const NAME = String.raw`(?:[a-z][\w-]{0,31}(?:流程|状态|页面)?|[\p{Script=Han}]{2,9}(?:流程|状态|页面))`;
const TRANSITION = new RegExp(String.raw`(?:^|[，,；;]\s*(?:并且|以及|且|并|随后)?\s*)(?:从|from\s+)?(${NAME})(?:可以|可|将|会|立即|直接|自动|\s)*(${ACTION.source})\s*(${NAME})(?=$|[。！？.!?，,；;])`,"iu");

const normalize = (text: string) => text.normalize("NFKC").replace(/[\s*_\x60]/gu, "").toLowerCase();
const edgeKey = ({ from, to, condition }: Transition) => JSON.stringify([normalize(from), normalize(to), normalize(condition ?? "")]);

function transitions(text: string): Transition[] {
  return text.split(/\n|(?<=[。！？])|(?<=[.!?])(?=\s)/u).flatMap(line => {
    const clause = line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/u, "").replace(/[\x60*]/gu, "").trim();
    if (!clause) return [];
    const arrow = ARROW.exec(clause);
    if (arrow) return [{ from: arrow[1], to: arrow[2], condition: arrow[3], branch: false }];
    const state = TRANSITION.exec(clause);
    if (!state) return [];
    const prefix = clause.slice(0, state.index).trim();
    const condition = /^(?:当|若|如果|if |when )/iu.test(prefix);
    if(prefix&&!condition&&/如果|若|仅当|除非|\b(?:if|when|unless)\b/iu.test(prefix))return [];
    const lead=condition?prefix.replace(/[，,]\s*$/u,""):"";
    return [{ from: state[1], to: state[3], condition: lead || undefined, branch: /升级|降级|回退|返回|escalat|fall|return/iu.test(state[2]) }];
  });
}

/** A graph only uses transitions present, with their guard, in the cited
 * original. Statuses or route names alone do not establish any edge. */
export function wikiStateGraphs(body: string, claims: readonly WikiClaim[]) {
  const groups = new Map<string, WikiStateEdge[]>();
  for (const claim of claims) {
    if (claim.markOnly || claim.holder === "earlier" || claim.holder === "open" || !claim.quote || !claim.evidenceIds.length
      || !body.includes(claim.text) || claim.verification === "uncertain") continue;
    const edges = transitions(claim.text);
    if (!edges.length) continue;
    const original = new Set(transitions(claim.quote).map(edgeKey));
    const nearby = body.slice(0, body.indexOf(claim.text)).match(/^#{1,6}\s+[^\n]+/gmu)?.at(-1) ?? "";
    const key = JSON.stringify([nearby, claim.holder ?? "", claim.scope ?? knowledgeStage(claim.text) ?? ""]);
    for (const edge of edges.filter(item => original.has(edgeKey(item)))) {
      const group = groups.get(key) ?? [];
      if (group.length && !knowledgeScopesAgree(group[0].claim.text, claim.text)) continue;
      if (!group.some(item => edgeKey(item) === edgeKey(edge))) group.push({ ...edge, claim });
      groups.set(key, group);
    }
  }
  return [...groups.values()].filter(edges => edges.length <= 12 && (
    edges.some(edge => edge.branch || edge.condition) || edges.some(edge => edges.some(other =>
      other !== edge && (other.from === edge.from || other.from === edge.to && other.to === edge.from)))));
}

export function wikiStateGraphMarkdown(edges: readonly WikiStateEdge[], zh: boolean, cite: (claim: WikiClaim) => string) {
  const nodes = new Map([...new Set(edges.flatMap(edge => [edge.from, edge.to]))].map((name, index) => [name, "n" + (index + 1)]));
  const literal = (text: string) => text.replace(/[^-\p{L}\p{N}\s./]/gu, " ").replace(/\s+/gu, " ").trim();
  const diagram = [
    "\x60\x60\x60mermaid", "flowchart TD",
    ...[...nodes].map(([label, id]) => "  " + id + '["' + literal(label) + '"]'),
    ...edges.map(edge => "  " + nodes.get(edge.from) + " --> " + (edge.condition ? '|"'+literal(edge.condition)+'"| ' : "") + nodes.get(edge.to)),
    "\x60\x60\x60",
  ].join("\n");
  const fallback = edges.map(edge => "- " + wikiLiteralText(edge.from) + " → " + wikiLiteralText(edge.to)
    + (edge.condition ? "（" + wikiLiteralText(edge.condition) + "）" : "") + cite(edge.claim)).join("\n");
  const discussed=edges[0]?.claim.holder==="ai"||edges[0]?.claim.holder==="material";
  const heading=discussed?(zh?"**状态转换 · 讨论方案**":"**State transitions · proposal**"):(zh?"**状态转换**":"**State transitions**");
  return [heading, diagram, fallback].join("\n\n");
}
