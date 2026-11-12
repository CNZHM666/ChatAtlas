import type { WikiKnowledgeUnit, WikiTopicChain } from "./wiki-knowledge";

/** A rename of one named item: 将“今日任务0/7”改为“今日重点0/1”. */
const RENAME = /将?“([^”]{1,16})”(?:模块|按钮|入口|卡片)?(?:升级为|改为|改成|更名为|调整为|替换为|命名为)“([^”]{1,20})”/u;
/** The home screen's central control, however a unit names it: 中央“+”, 中间的加号按钮, 中央AI按钮, 中央按钮. */
const CENTRAL = /(?:中央|中间)(?:悬浮)?的?(?:(?:“[+＋]”号?|[+＋]号?|加号|AI)?按钮|“[+＋]”号?|[+＋]号?|加号)/u;
const key = (name: string) => name.replace(/[\d/／\s]+/gu, "").toLowerCase();
/** A version as a note tells it: its own ；read as a comma, so the note's ；parts only the versions (the export lists
 * each as one line; 「付费墙在第3天…；最终建议先免费开放7天…；待验证付费后…」 read as three). */
const bare = (text: string) => text.trim().replace(/[。.]$/u, "").replace(/；/gu, "，");

export interface DifferingPlans { unitIds: string[]; note: string }

/** Points the discussion left differing, that no answer settled and no decision chose between:
 * - one item renamed two ways by current suggestions (「今日任务」 to 「今天只做这一件事」, recommending 1-3 actions, and to
 *   「今日重点0/1」, one task): both read as the plan, neither marked open;
 * - the user's own idea for the home screen's central control beside the AI's suggestion for it (the user would open the
 *   AI page from the + button; the AI would make it a 守护 entry).
 * Each comes back as a note naming both, in the units' own words. */
export function differingPlans(units: WikiKnowledgeUnit[], statusOf: (id: string) => string | undefined, zh: boolean, topics: WikiTopicChain[] = []): DifferingPlans[] {
  if (!zh) return [];
  // A thing the version chains found left open, whatever its words: each version that holds, the user's first.
  const byId = new Map(units.map(unit => [unit.id, unit])), own = (unit: WikiKnowledgeUnit) => unit.evidence.role === "user" && !unit.evidence.pasted;
  const fromTopics = topics.filter(topic => topic.open && topic.current.every(id => statusOf(id) === "open")).flatMap(topic => {
    const members = topic.current.flatMap(id => byId.get(id) ?? []).sort((a, b) => Number(own(b)) - Number(own(a)));
    if (members.length < 2) return [];
    return [{ unitIds: members.map(unit => unit.id), note: `${topic.name}：${members.map(unit => `${own(unit) ? "你提议" : "AI 建议"}${bare(unit.statement.trim().replace(/^用户(?:提议|提出|希望|认为)/u, ""))}`).join("；")}。` }];
  });
  // A version the chains settled is no open question by any other reading: 「付费墙在第3天」 beside the trial of 7 days the
  // chain found holding now read as 付费出现的时间有两种说法.
  const noted = new Set([...fromTopics.flatMap(item => item.unitIds), ...topics.filter(topic => !topic.open).flatMap(topic => [...topic.current, ...topic.earlier])]);
  const current = units.filter(unit => !["history", "confirmed", "open", "contested"].includes(statusOf(unit.id) ?? "") && !unit.about && !noted.has(unit.id));
  const found: DifferingPlans[] = [...fromTopics];
  const renames = new Map<string, WikiKnowledgeUnit[]>();
  for (const unit of current) {
    const match = unit.statement.match(RENAME);
    if (match) renames.set(key(match[1]), [...renames.get(key(match[1])) ?? [], unit]);
  }
  for (const [item, list] of renames) {
    const targets = new Map(list.map(unit => [key(unit.statement.match(RENAME)![2]), unit]));
    if (targets.size < 2 || units.some(unit => statusOf(unit.id) === "confirmed" && unit.statement.match(RENAME) && key(unit.statement.match(RENAME)![1]) === item)) continue;
    const chosen = [...targets.values()];
    const name = list[0].statement.match(RENAME)![1].replace(/[\d/／]+$/u, "");
    found.push({ unitIds: chosen.map(unit => unit.id), note: `「${name}」有${chosen.length === 2 ? "两" : "几"}种改法：${chosen.map(unit => bare(unit.statement)).join("；")}。` });
  }
  const yours = current.filter(unit => unit.evidence.role === "user" && !unit.evidence.pasted && CENTRAL.test(unit.statement));
  const theirs = current.filter(unit => unit.evidence.role === "assistant" && CENTRAL.test(unit.statement.slice(0, 8)) && /“守护”|“[^”]{1,8}”/u.test(unit.statement));
  for (const mine of yours) {
    const against = theirs.filter(unit => [...unit.statement.matchAll(/“([^”+＋]{1,8})”/gu)].some(match => !mine.statement.includes(match[1])));
    if (!against.length) continue;
    // A later reply taking the user's idea up (「采纳中间按钮跳转AI及任务/复盘由AI主导的方向……」): the AI's name for the button
    // and the user's use of it hold together, no question left between them.
    const after = Math.max(...[mine, ...against].map(unit => unit.evidence.messageIndex));
    if (units.some(unit => unit.evidence.conversationId === mine.evidence.conversationId && unit.evidence.messageIndex > after && statusOf(unit.id) !== "history" && ADOPTS.test(unit.statement) && CENTRAL.test(unit.statement))) continue;
    const told = mine.statement.trim().replace(/^用户(?:提议|提出|希望|认为)/u, "");
    // One AI suggestion names the other side: three that each made it a 守护 entry made the note three times as long.
    found.push({ unitIds: [mine.id, ...against.map(unit => unit.id)], note: `首页中央按钮的用法：你提议${bare(told)}；AI 建议${bare(against[0].statement)}${against.length > 1 ? `（另有 ${against.length - 1} 条类似建议）` : ""}。` });
  }
  const said = new Set(found.flatMap(item => item.unitIds));
  const fresh = current.filter(unit => !said.has(unit.id));
  // One step given two lengths: 「破戒后提供30秒结构化复盘（时间、场景、情绪、诱因）」 and 「通过60秒快速复盘（时间、情绪、阻断
  // 措施）」, both after a relapse, each read as the plan.
  const timed = new Map<string, Map<string, WikiKnowledgeUnit>>();
  for (const unit of fresh) {
    const match = unit.statement.match(TIMED_STEP);
    if (!match) continue;
    const step = match[3], length = `${match[1]}${match[2]}`, lengths = timed.get(step) ?? new Map<string, WikiKnowledgeUnit>();
    if (!lengths.has(length)) lengths.set(length, unit);
    timed.set(step, lengths);
  }
  for (const [step, lengths] of timed) {
    const [first, second] = [...lengths.values()];
    if (lengths.size !== 2 || !sharesContext(first, second)) continue;
    // A length the user confirmed settles it: 「第二版增加……60秒复盘……」, confirmed, while the note still read open.
    const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    if (units.some(unit => statusOf(unit.id) === "confirmed" && [...lengths.keys()].some(length => new RegExp(`${escaped(length)}[^，。；,;]{0,4}${escaped(step)}`, "u").test(unit.statement)))) continue;
    found.push({ unitIds: [first.id, second.id], note: `「${step}」的时长有两种说法：${bare(first.statement)}；${bare(second.statement)}。` });
  }
  // One flow given two sets of steps from the same start: 选择目标→设置高风险时间→开启挑战→完成首次打卡→获得即时反馈, and
  // 选择目标-高危时间-生成计划-打卡-加入小组.
  const paths = new Map<string, WikiKnowledgeUnit[]>();
  for (const unit of fresh) {
    const path = unit.statement.match(STEP_PATH)?.[0];
    if (!path) continue;
    const steps = path.split(/\s*(?:→|->|－|-)\s*/u), start = steps[0];
    if (!(paths.get(start) ?? []).some(other => other.statement.match(STEP_PATH)![0].split(/\s*(?:→|->|－|-)\s*/u).join("|") === steps.join("|"))) paths.set(start, [...paths.get(start) ?? [], unit]);
  }
  for (const [start, list] of paths) {
    if (list.length !== 2) continue;
    found.push({ unitIds: list.map(unit => unit.id), note: `从「${start}」开始的流程有两种写法：${list.map(unit => bare(unit.statement)).join("；")}。` });
  }
  // When payment first shows, said two ways: a paywall on day 3 beside a free trial of 7 days.
  const wall = fresh.find(unit => PAYWALL_DAY.test(unit.statement)), trial = fresh.find(unit => FREE_DAYS.test(unit.statement));
  if (wall && trial && wall.id !== trial.id) {
    const day = Number(wall.statement.match(PAYWALL_DAY)!.slice(1).find(Boolean)), days = Number(trial.statement.match(FREE_DAYS)![1]);
    if (day < days) found.push({ unitIds: [wall.id, trial.id], note: `付费出现的时间有两种说法：${bare(wall.statement)}；${bare(trial.statement)}。` });
  }
  return found;
}

/** The AI's own name for the home screen's central control, given before a later reply of the same conversation took up the
 * user's idea for it instead (「中央悬浮“+”号含义不明，建议改为盾牌……标注“守护”」, then 「采纳中间按钮跳转AI……的方向」): that
 * suggestion no longer stands, whatever its status. Returns the ids of such suggestions. */
export function outgrownCentralNames(units: WikiKnowledgeUnit[], statusOf: (id: string) => string | undefined): Set<string> {
  return new Set(outgrownCentralBy(units, statusOf).keys());
}

/** The same suggestions, each with what outgrew it: the user's idea and the replies taking it up. */
export function outgrownCentralBy(units: WikiKnowledgeUnit[], statusOf: (id: string) => string | undefined): Map<string, string[]> {
  const mine = units.filter(unit => unit.evidence.role === "user" && !unit.evidence.pasted && CENTRAL.test(unit.statement));
  const named = units.filter(unit => unit.evidence.role === "assistant" && statusOf(unit.id) !== "confirmed" && CENTRAL.test(unit.statement) && /“[^”+＋]{1,8}”/u.test(unit.statement) && !ADOPTS.test(unit.statement));
  const found = new Map<string, string[]>();
  for (const unit of named) {
    const later = mine.filter(own => own.evidence.conversationId === unit.evidence.conversationId && own.evidence.messageIndex > unit.evidence.messageIndex).flatMap(own => {
      const replies = units.filter(reply => reply.evidence.conversationId === own.evidence.conversationId && reply.evidence.messageIndex > own.evidence.messageIndex && statusOf(reply.id) !== "history" && ADOPTS.test(reply.statement) && CENTRAL.test(reply.statement));
      return replies.length ? [own, ...replies] : [];
    });
    if (later.length) found.set(unit.id, [...new Set(later.map(item => item.id))]);
  }
  return found;
}

/** A step and how long it takes: 30秒结构化复盘, 60秒快速复盘. */
const TIMED_STEP = /(\d+)\s*(秒|分钟)[^，。；、\d]{0,4}?(复盘|评估|自救流程)/u;
/** Steps joined by arrows or dashes, three at least: 选择目标→设置高风险时间→开启挑战. */
const STEP = String.raw`[^\s，。；：:“”"（）()→\-－\d]{2,10}`;
const STEP_PATH = new RegExp(`${STEP}(?:\\s*(?:→|->|－|-)\\s*${STEP}){2,}`, "u");
/** A paywall on a day: 付费墙在第3天, 第3天……出现付费钩子. */
const PAYWALL_DAY = /付费(?:墙|入口|页|钩子)[^，。；]{0,12}第\s*(\d+)\s*天|第\s*(\d+)\s*天[^，。；]{0,16}付费(?:墙|入口|页|钩子)/u;
/** A free trial of some days: 先免费开放7天. */
const FREE_DAYS = /免费(?:开放|体验)?\s*(\d+)\s*天/u;
/** Whether two units speak of one situation: a few words of their own in common (破戒 in both). */
const sharesContext = (first: WikiKnowledgeUnit, second: WikiKnowledgeUnit) => {
  const bigrams = (text: string) => new Set(Array.from({ length: Math.max(0, text.length - 1) }, (_, at) => text.slice(at, at + 2)).filter(pair => /^\p{Script=Han}{2}$/u.test(pair)));
  const left = bigrams(first.statement), right = bigrams(second.statement);
  return [...left].filter(pair => right.has(pair) && !/复盘|秒|分钟/u.test(pair)).length >= SHARED_CONTEXT;
};
const SHARED_CONTEXT = 2;
/** A reply taking an idea up: 采纳……的方向, 同意你的…… */
const ADOPTS = /^(?:采纳|同意|认可|接受|按照?你)/u;

export interface DecidedAgainstDeclined { decidedId: string; declinedIds: string[]; clause: string; note: string }
/** A decision the user confirmed whose clause holds what they turned down in another point: the plan of three versions,
 * confirmed, with 「第三版加入自动分组」, beside 「采用系统自动分配同期小组（滚动制）」, rejected. Both stood as told, the
 * rejection under the earlier versions and the plan as decided, and nothing asked which holds. A clause and a rejected
 * point are read as one thing when they share a run of SHARED_RUN Han characters that mostly points turned down say
 * (自动分); a run many current points say (守护小组, a card on the home screen) names no thing turned down. */
export function decidedAgainstDeclined(units: WikiKnowledgeUnit[], statusOf: (id: string) => string | undefined, declined: (id: string) => boolean): DecidedAgainstDeclined[] {
  const turnedDown = units.filter(unit => declined(unit.id));
  if (!turnedDown.length) return [];
  const found: DecidedAgainstDeclined[] = [];
  for (const unit of units.filter(item => statusOf(item.id) === "confirmed" && !declined(item.id))) {
    const others = units.filter(other => other.id !== unit.id);
    // A run one of several points turned down says is a detail of that one (守护小组, where 用户开始计划后自动分配至守护小组 was
    // turned down); one most of them say is what was turned down (自动分).
    const declinedRun = (run: string) => {
      const holders = others.filter(other => other.statement.includes(run)), saying = holders.filter(other => declined(other.id)).length;
      return saying > 0 && saying / holders.length >= DECLINED_SHARE && (saying >= DECLINED_SAYING || turnedDown.length === 1);
    };
    for (const clause of unit.statement.split(/[；;，,、：:。]/u).map(item => item.trim()).filter(item => item.length >= 4)) {
      const runs = Array.from({ length: Math.max(0, clause.length - SHARED_RUN + 1) }, (_, at) => clause.slice(at, at + SHARED_RUN)).filter(run => /^\p{Script=Han}+$/u.test(run) && !RUN_STOP.test(run) && declinedRun(run));
      const against = turnedDown.filter(other => runs.some(run => other.statement.includes(run)));
      if (!against.length) continue;
      found.push({ decidedId: unit.id, declinedIds: against.map(other => other.id), clause, note: `你确认的决定含「${clause}」，但你否定过「${bare(against[0].statement)}」${against.length > 1 ? `（另有 ${against.length - 1} 条类似）` : ""}，是否保留需要你确认。` });
      break;
    }
  }
  return found;
}
const SHARED_RUN = 3, DECLINED_SHARE = .5, DECLINED_SAYING = 2;
/** Words that join others: a run through them (用户的, 并在后) names no thing of its own. */
const RUN_STOP = /[的了在和与及或为是将把被由对从而并以等中后前也都]/u;

/** A step given another length than the one a confirmed plan gives it, beside a current point telling the confirmed length
 * of the same step in the same situation: the plan of three versions, confirmed, holds 「60秒复盘」; 「破戒后……通过60秒快速
 * 复盘……」 tells it; 「失守后……提供低负担的30秒复盘……」 gave another length, and both read as the plan. One note per such
 * point, on that point alone, naming the confirmed length. */
export function lengthAgainstDecided(units: WikiKnowledgeUnit[], statusOf: (id: string) => string | undefined, zh: boolean): DifferingPlans[] {
  if (!zh) return [];
  const decided = units.filter(unit => statusOf(unit.id) === "confirmed").flatMap(unit => [...unit.statement.matchAll(new RegExp(TIMED_STEP.source, "gu"))].map(match => ({ step: match[3], length: `${match[1]}${match[2]}` })));
  if (!decided.length) return [];
  const current = units.filter(unit => !["history", "confirmed", "open", "contested"].includes(statusOf(unit.id) ?? "") && !unit.about);
  // Several points giving the step another length are one question: 「失守后……30秒复盘」 and 「破戒后提供30秒结构化复盘」 were
  // two open questions under one title, 「「复盘」的时长」, each naming the confirmed 60秒.
  const found = current.flatMap(unit => {
    const match = unit.statement.match(TIMED_STEP);
    if (!match) return [];
    const length = `${match[1]}${match[2]}`, settled = decided.find(item => item.step === match[3] && item.length !== length);
    if (!settled || decided.some(item => item.step === match[3] && item.length === length)) return [];
    const telling = current.some(other => other !== unit && other.statement.match(TIMED_STEP)?.[3] === match[3] && `${other.statement.match(TIMED_STEP)![1]}${other.statement.match(TIMED_STEP)![2]}` === settled.length && sharesContext(unit, other));
    return telling ? [{ unit, step: match[3], settled: `${settled.length}${settled.step}` }] : [];
  });
  const byStep = new Map<string, typeof found>();
  for (const item of found) byStep.set(`${item.step}\n${item.settled}`, [...byStep.get(`${item.step}\n${item.settled}`) ?? [], item]);
  return [...byStep.values()].map(items => ({ unitIds: items.map(item => item.unit.id), note: `「${items[0].step}」的时长：你确认的规划为${items[0].settled}；${items.map(item => `另有建议${bare(item.unit.statement)}`).join("；")}。` }));
}
