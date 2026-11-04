import { knowledgeTerms } from "../shared/knowledge-subject";
import { stageWord } from "./wiki-draft-checks";
import { wikiUserChooses } from "../shared/wiki-user-choice";
import { assistantRequest, DECIDING_KINDS, personalDirection, STATE_KINDS, type WikiKnowledgeUnit, type WikiKnowledgeOrganization, type WikiKnowledgeLedger, type WikiUnitStatus, type WikiDraftChapter, type WikiBaselineItem } from "../shared/wiki-knowledge";

const ANALYSIS_KINDS: WikiKnowledgeUnit["kind"][] = ["fact", "report", "history", "question"];
// A user's own decision says what to do; an observation or a question checking understanding does not.
// Liking one of the shown designs ("我喜欢这种设计") or settling on it ("就这个") chooses it too.
/** A confirmed point: a deciding kind, accepted from a proposal or chosen in the user's own words. */
const decides = (unit: WikiKnowledgeUnit) => !unit.about && DECIDING_KINDS.includes(unit.kind) && (unit.adoption.status === "user_adopted" || unit.adoption.status === "user_decision" && wikiUserChooses(unit.evidence.quote));

/** A unit's status from its own adoption and the checked relations. */
export function wikiUnitStatuses(units: WikiKnowledgeUnit[], organization: Pick<WikiKnowledgeOrganization, "relations">, decisions: WikiKnowledgeLedger["decisions"] = {}) {
  const history = new Set<string>(), open = new Set<string>();
  const byId = new Map(units.map(unit => [unit.id, unit])), own = (id: string) => byId.get(id)?.evidence.role === "user" && !byId.get(id)?.evidence.pasted;
  for (const relation of organization.relations) {
    if (relation.kind !== "replaces" && relation.kind !== "rejects") continue;
    if (relation.status === "resolved") history.add(relation.older);
    // An assistant rewording its own suggestion is not an open question; a change touching the user's words is.
    else if (own(relation.older) || own(relation.newer)) { open.add(relation.older); open.add(relation.newer); }
  }
  // A proposal or question beside a user's decision refines it; the decided point is not reopened.
  // Two decisions in an unsettled conflict are different: confirmed once is not the same as holding now.
  const decided = new Set(units.filter(decides).map(unit => unit.id)), contested = new Set<string>();
  for (const relation of organization.relations) {
    if (!decided.has(relation.older) && !decided.has(relation.newer)) continue;
    if ((relation.kind === "replaces" || relation.kind === "rejects") && relation.status === "unresolved" && decided.has(relation.older) && decided.has(relation.newer)) { contested.add(relation.older); contested.add(relation.newer); continue; }
    open.delete(relation.older); open.delete(relation.newer);
  }
  return new Map(units.map(unit => [unit.id, ((): WikiUnitStatus => {
    // The user's own verdict in the ledger outranks what the conversation shows.
    if (decisions[unit.id]?.verdict === "confirmed") return "confirmed";
    if (decisions[unit.id]?.verdict === "rejected") return "history";
    if (decisions[unit.id]?.verdict === "open") return "open";
    if (history.has(unit.id) || unit.adoption.status === "rejected") return "history";
    if (contested.has(unit.id)) return "contested";
    // A phase restriction does not withdraw adoption of the broader direction.
    // Keep scope in the relation; only an actual replacement or user verdict changes adoption.
    // A decision needs a deciding kind; the user's view or complaint is what the user said.
    if (decides(unit)) return "confirmed";
    // Pasted material (a review, an export, another product's notes) is relayed, not the user's own report.
    // Only a state can be reported; "必须支持…" from a pasted export is a requirement, not a built state.
    if (unit.delivery === "user_reported" && STATE_KINDS.includes(unit.kind)) return unit.evidence.pasted ? "relayed" : "reported";
    if (open.has(unit.id)) return "open";
    // Anything else from pasted material (a requirement in a review, a design in an export) is what that material says.
    if (unit.evidence.pasted) return "relayed";
    if (unit.evidence.role === "user") return "stated";
    // An assistant's account of facts, other products or concepts is analysis; adoption does not apply to it.
    return ANALYSIS_KINDS.includes(unit.kind) ? "analysis" : "proposal";
  })()]));
}

const BASELINE_NOW = /下一阶段|接下来|当前重点|重点转向|当前阶段|本阶段|本轮|现阶段|\bPhase\s*[A-Z0-9]\b|里程碑|\bMilestone\s*[\d.]+|\bnext (?:phase|milestone)\b|\bthis (?:phase|iteration|sprint|round)\b|\bcurrent (?:phase|focus|milestone)\b/iu;
const BASELINE_LEAVES = /不做|不开发|不支持|不包含|禁止(?:扩展|开发|加入)|暂不|暂缓|不进行|不实现|不引入|冻结|\b(?:won'?t (?:build|do|support|include|ship|add)|not (?:build|support|include|ship|add)|out of scope:?|defer(?:red)?|postpone[sd]?|freeze)\b/iu, BASELINE_CURRENT = /当前|本阶段|本轮|现阶段|第一版|\bV0\.1\b|\bthis (?:phase|iteration|sprint|round|release)\b|\bcurrent (?:phase|milestone)\b|\bfirst (?:version|release)\b|\bfor now\b|\bMVP\b/iu;
const BASELINE_DONE = /完成标准|完成定义|完成(?:时|后|前)?需(?:要)?具备|(?<!未)完成条件|验收|算完成|Definition of Done|必须全部通过|(?:通过率|成功率)\s*[>≥＞]|\b(?:acceptance criteria|done when|must (?:all )?pass|success criteria)\b/iu;
const BASELINE_ITEMS = { now: 3, notNow: 2, done: 3 } as const, BASELINE_SAME = .6;
/** The items a line leaves out ("本阶段明确不做 PCB/KiCad/专业仿真/高压设计"), and nouns too general to stand for one. */
const LEFT_OUT_ITEMS = /(?:不做|禁止(?:扩展|开发|加入)?|暂不(?:做|开发|实现)?|暂缓(?:开发)?|不进行|不实现|不引入|\b(?:won'?t (?:build|do|support|include|ship|add)|not (?:build|support|include|ship|add)|out of scope:?|defer(?:red)?|postpone[sd]?)\b)[：:]?\s*((?:[^。；;.]|\.(?=\w))+)/iu, GENERIC_NOUN = /^(?:生成|开发|设计|功能|系统|模型|服务|管理|数据|工具|平台|识别|社区)$/u;
/** The baseline a reader continuing the work needs first, from the effective source scope: the latest plans of the
 * current stage, the latest things left out now, and what counts as done. Each is a unit's own statement, whole, so it
 * names its subject; an earlier plan (此前) or a contested one is no baseline. Latest first by discussion order, shown
 * in that order. */
/** What a limit leaves out, whatever its verb (不开发、不包含、禁止、暂不……). */
const LIMITED_ITEMS = /(?:不做|不开发|不支持|不包含|不提供|禁止(?:开发)?|严禁|暂不(?:做|开发|实现|提供)?|暂缓(?:开发)?|不进行|不实现|不引入)[：:]?\s*([^。；;]+)/u;
/** answered: the points the user's answers before or while writing confirmed. A limit leaving out what one of them puts
 * in ("本阶段不开发实时商品比价" after the user answered that it does include 比价推荐及链接) is no current limit: one run
 * listed it under 暂不做 beside the user's own answer. */
export function currentBaseline(units: WikiKnowledgeUnit[], statuses: Map<string, WikiUnitStatus>, takenUp: Map<string, string[]> = new Map(), answered: WikiKnowledgeUnit[] = []): WikiBaselineItem[] {
  const overridden = (scope: WikiKnowledgeUnit) => (scope.statement.match(LIMITED_ITEMS)?.[1] ?? "").split(/[、/，,]|以及|及|和|与|或/u).map(part => part.trim().replace(/^(?:开发|实现|支持|做)/u, "").replace(/^(?:实时|全网|在线|商品)+/u, "")).filter(part => part.length >= 2 && !GENERIC_NOUN.test(part))
    .some(part => answered.some(unit => unit.statement.includes(part) || part.length > 2 && unit.statement.includes(part.slice(-2))));
  // Message indices are comparable only inside one conversation. Keep source order across conversations.
  const conversations = [...new Set(units.map(unit => unit.evidence.conversationId))];
  // Working steps for an AI and the user's own direction are no baseline: "给 Codex 的指令应包含……验收标准" was read as one.
  const live = units.filter(unit => !unit.about && !assistantRequest(unit.statement) && !personalDirection(unit.statement) && !["history", "contested", "open"].includes(statuses.get(unit.id)!)).sort((a, b) =>
    a.evidence.conversationId === b.evidence.conversationId ? b.evidence.messageIndex - a.evidence.messageIndex
      : conversations.indexOf(a.evidence.conversationId) - conversations.indexOf(b.evidence.conversationId));
  const holder = (unit: WikiKnowledgeUnit) => { const status = statuses.get(unit.id); return status === "confirmed" ? { holder: "decided" as const } : status === "stated" || status === "reported" ? { holder: "user" as const } : {}; };
  const taken = new Set<string>();
  // One point said twice ("现阶段继续使用 Orama……" in two messages) is one item: the later wording.
  const said: Array<Set<string>> = [], again = (unit: WikiKnowledgeUnit) => { const own = knowledgeTerms(unit.statement); return said.some(other => { let shared = 0; for (const term of own) if (other.has(term)) shared++; return shared / Math.max(1, Math.min(own.size, other.size)) >= BASELINE_SAME; }); };
  const pick = (part: WikiBaselineItem["part"], test: (unit: WikiKnowledgeUnit) => boolean) => {
    const items: WikiBaselineItem[] = [];
    for (const unit of live) { if (items.length >= BASELINE_ITEMS[part]) break; if (taken.has(unit.id) || !test(unit) || again(unit)) continue; taken.add(unit.id); said.push(knowledgeTerms(unit.statement)); items.push({ part, text: unit.statement.trim(), unitIds: [unit.id], ...holder(unit) }); }
    return items.reverse();
  };
  // What is left out now is read first: a criterion of a later, fuller product ("仿真运行率>80%" while 仿真 is left out
  // now) is no criterion of the current work. One line per stage: two lists of one stage told it twice.
  const stages = new Set<string>();
  // A line of an earlier stage, whose items later discussion took up, is not what is left out now.
  const notNow = pick("notNow", unit => { if (takenUp.has(unit.id) || overridden(unit) || !BASELINE_LEAVES.test(unit.statement) || !BASELINE_CURRENT.test(unit.statement)) return false; const stage = stageWord(unit.statement) ?? unit.statement.match(BASELINE_CURRENT)![0]; if (stages.has(stage)) return false; stages.add(stage); return true; });
  const currentScopes = live.filter(unit => notNow.some(item => item.unitIds.includes(unit.id)));
  const leavesOut = (scope: WikiKnowledgeUnit) => (scope.statement.match(LEFT_OUT_ITEMS)?.[1] ?? "").split(/[、/，,]|以及|及|和|与/u).map(part => part.trim().replace(/^(?:开发|实现|支持)/u, "")).filter(part => part.length >= 2);
  // A stage word naming a part in a list ("当前进展、下一步行动、关键决策" are an overview's modules) says no stage.
  const staged = (text: string) => stageTransition(text) || [...text.matchAll(new RegExp(BASELINE_NOW.source, "giu"))].some(match => ((match.index ?? 0) < 8 || /Milestone|Phase|里程碑/iu.test(match[0])) && !/^[^。，,；;]{0,5}[、→」”]/u.test(text.slice((match.index ?? 0) + match[0].length)));
  // A state is what the work is now only as the user reports it: the assistant's account ("项目已进入系统测试……
  // 177 项测试通过") is no task, and stood beside the tasks as one.
  const candidates = live.filter(unit => (["plan", "decision"].includes(unit.kind) || ["report", "fact"].includes(unit.kind) && ["reported", "confirmed", "stated"].includes(statuses.get(unit.id)!)) && staged(unit.statement)
    && !/^(?:默认)?(?:只|仅)?(?:展示|显示|提示)|\b(?:display|show) (?:the )?current phase\b/iu.test(unit.statement)
    && (stageTransition(unit.statement) || !BASELINE_LEAVES.test(unit.statement) && ["plan", "decision"].includes(unit.kind)));
  // The latest entry into a stage ("建议进入 Milestone 5 Alpha Validation 阶段，冻结大功能") ends the stages before it: a
  // plan said earlier in its conversation ("按 Phase A 至 Phase B 逐步实现") and the criteria of earlier stages ("第一阶段
  // ……仿真运行率>80%", a milestone's 七个验收场景) were read as current beside it.
  const entered = candidates.find(unit => stageTransition(unit.statement));
  const before = (unit: WikiKnowledgeUnit) => Boolean(entered) && unit !== entered && unit.evidence.conversationId === entered!.evidence.conversationId && unit.evidence.messageIndex < entered!.evidence.messageIndex;
  const criteria = live.filter(unit => BASELINE_DONE.test(unit.statement) && !currentScopes.some(scope => scope.evidence.conversationId === unit.evidence.conversationId && leavesOut(scope).some(part => unit.statement.toLocaleLowerCase().includes(part.toLocaleLowerCase()))));
  const currentCriteria = criteria.some(unit => !before(unit));
  const done = pick("done", unit => criteria.includes(unit) && (!currentCriteria || !before(unit)));
  const now = pick("now", unit => candidates.includes(unit) && !before(unit));
  return [...now, ...notNow, ...done];
}

/** A project entering a phase, including a proposed transition with a feature freeze.
 * Merely asking the UI to display a current-stage hint is not a transition. */
function stageTransition(text: string): boolean {
  return /(?:项目|产品|下一阶段|当前阶段|本阶段)[^。；;]{0,16}(?:进入|转入|推进到)|(?:进入|转入|定义为)[^。；;]{0,20}(?:Milestone|Phase|里程碑)|\b(?:project|product|next phase)\b[^.;]{0,35}\b(?:enter|move|focus|implement)|\b(?:enter|move to)\b[^.;]{0,20}\b(?:milestone|phase)\b/iu.test(text);
}

/** A line leaving items out of the current stage or first version ("第一版 MVP……不提供实时商品搜索、比价或购买链接"). */
const SCOPE_LEAVES = /(?:不做|不提供|不包含|不开发|不实现|不进行|不引入|暂不(?:做|提供|开发|实现)?|暂缓(?:开发)?|禁止(?:开发|扩展|加入)?|\b(?:won'?t (?:build|do|support|include|ship|add)|not (?:build|support|include|ship|add)|out of scope:?|defer(?:red)?|postpone[sd]?)\b)[：:]?\s*((?:[^。；;.]|\.(?=\w))+)/iu;
/** A wish the user stated for the product ("项目应提供元件购买清单、比价推荐及链接功能"), then left out of the first version or
 * the current stage by a later line, is a direction, not the current scope: one run marked it 已定 beside "第一版 MVP……不
 * 提供比价或购买链接", and the reader could not tell which holds now. The later line narrows it; the wish is then the
 * adopted direction, with a separate scope restriction. Returns the organization with those relations added. */
export function scopedWishes(organization: WikiKnowledgeOrganization, units: Map<string, WikiKnowledgeUnit>, report: Record<string, number> = {}): WikiKnowledgeOrganization {
  const live = organization.subjects.flatMap(subject => subject.unitIds).map(id => units.get(id)).filter((unit): unit is WikiKnowledgeUnit => Boolean(unit) && !unit!.about);
  const related = new Set(organization.relations.map(relation => `${relation.older}|${relation.newer}`));
  const added: WikiKnowledgeOrganization["relations"] = [];
  for (const wish of live.filter(unit => decides(unit) && !SCOPE_LEAVES.test(unit.statement))) {
    for (const scope of live) {
      if (scope === wish || scope.evidence.conversationId !== wish.evidence.conversationId || scope.evidence.messageIndex <= wish.evidence.messageIndex || !BASELINE_CURRENT.test(scope.statement) || related.has(`${wish.id}|${scope.id}`)) continue;
      const items = (scope.statement.match(SCOPE_LEAVES)?.[1] ?? "").split(/[、/，,]|或|以及|及|和|与/u).map(part => part.trim().replace(/^(?:实时|任何|完整的?)/u, "")).filter(part => part.length >= 2 && !GENERIC_NOUN.test(part));
      if (!items.some(item => wish.statement.includes(item))) continue;
      added.push({ older: wish.id, newer: scope.id, kind: "narrows", status: "resolved" }); related.add(`${wish.id}|${scope.id}`);
      break;
    }
  }
  if (!added.length) return organization;
  report.wishes_scoped = added.length;
  return { ...organization, relations: [...organization.relations, ...added] };
}

/** A stage named as the present ("本阶段禁止开发拍照识别……"), and a later statement doing the item ("必须完整跑通从拍照识别
 * DHT22……的全链路"): a verb of doing it shortly before it. "PCB 尺寸确定后" names PCB without doing it. */
const PRESENT_STAGE = /本阶段|当前阶段|现阶段|本轮|当前迭代|本次迭代|\bthis (?:phase|iteration|sprint|round)\b|\bcurrent (?:phase|iteration)\b/iu, REFUSED_CLAUSE = /不|禁止|严禁|暂缓|避免|无需|未|除外|之前|之后再|后续|以后|\b(?:not|no|won'?t|defer\w*|later|avoid)\b/iu, DOES = /(?:(?:实现|支持|开发|接入|集成|跑通|完成|加入|提供|增加|上线|做|引入|启用)[^。，,；;]{0,8}|\b(?:implement|build|support|integrate|ship|add|enable|run)\w*\b[^.,;。，]{0,16})$/iu;
/** Items a line leaves out of the stage it calls the present, that a later statement takes up: "本阶段禁止开发拍照识别"
 * was said at Milestone 3, and the discussion built photo recognition at Milestone 4. The line is that earlier stage's
 * scope for those items only; it still leaves out the rest (PCB, Wokwi). By the left-out line's unit id. */
export function laterTakenUp(units: WikiKnowledgeUnit[]): Map<string, string[]> {
  const own = units.filter(unit => !unit.about), taken = new Map<string, string[]>();
  for (const scope of own.filter(unit => PRESENT_STAGE.test(unit.statement))) {
    const items = [...scope.statement.matchAll(new RegExp(SCOPE_LEAVES.source, "giu"))].flatMap(match => match[1].split(/[、/，,]|或|以及|及|和|与|\b(?:and|or)\b/iu))
      .map(part => part.trim().replace(/^(?:开发|实现|支持|实时|任何)|等(?:功能)?$|功能$/gu, "").trim()).filter(part => part.length >= 2 && part.length <= 24 && !GENERIC_NOUN.test(part));
    // Done in the clause naming it, with no refusal anywhere in that clause ("仅支持低压模块，不支持高压设备", "暂缓 PCB 绘制").
    const does = (statement: string, item: string) => statement.split(/[，,。；;]/u).some(clause => { const at = clause.indexOf(item); return at >= 0 && DOES.test(clause.slice(0, at)) && !REFUSED_CLAUSE.test(clause); });
    const later = items.filter(item => item !== "测试" && own.some(other => other !== scope && other.evidence.conversationId === scope.evidence.conversationId && other.evidence.messageIndex > scope.evidence.messageIndex && does(other.statement, item)));
    if (later.length) taken.set(scope.id, [...new Set(later)]);
  }
  return taken;
}
/** The present-stage word of a sentence leaving out an item taken up later reads as that stage, past: "本阶段禁止开发拍照识
 * 别" told as the current scope beside "必须跑通拍照识别全链路" left the reader to guess which holds. Returns how many. */
export function pastStageWords(chapters: WikiDraftChapter[], taken: Map<string, string[]>): number {
  let changed = 0;
  for (const chapter of chapters) for (const paragraph of chapter.paragraphs) {
    const items = paragraph.unitIds.flatMap(id => taken.get(id) ?? []);
    if (!items.length) continue;
    const text = paragraph.text.split(/(?<=[。！？!?])(?![^“”「」\n]*[”」])|(?=\n)/u).map(sentence => items.some(item => sentence.includes(item)) && SCOPE_LEAVES.test(sentence) ? sentence.replace(PRESENT_STAGE, () => { changed++; return "当时阶段"; }) : sentence).join("");
    if (text === paragraph.text) continue;
    chapter.body = chapter.body.replace(paragraph.text, text);
    // A claim follows the text: only a sentence that leaves the item out changed ("本阶段目标是完成从拍照识别……" names it
    // and stays; its claim read "当时阶段目标……", no longer in the paragraph).
    for (const claim of paragraph.claims ?? []) { const past = claim.text.replace(PRESENT_STAGE, "当时阶段"); if (past !== claim.text && !text.includes(claim.text) && text.includes(past)) claim.text = past; }
    paragraph.text = text;
  }
  return changed;
}
