import { LEAVES_OUT } from "../shared/negation";
import { PHASE } from "../shared/stage-words";
import { knowledgeTerms } from "../shared/knowledge-subject";
import { wikiMeasure } from "../shared/wiki-section-status";
import { personalDirection, statesCore, type WikiKnowledgeOrganization, type WikiKnowledgeUnit, type WikiSubject } from "../shared/wiki-knowledge";

type Lane = "purpose" | "interface" | "technical" | "security" | "documentation" | "progress" | "stage" | "roadmap" | "quality" | "example" | "commerce" | "algorithm";
const TITLE: Record<Lane, RegExp> = {
  purpose: /定位|用户价值|核心价值|positioning|purpose/iu,
  interface: /界面|交互|视觉|interface|interaction|visual/iu,
  // Not 机制 alone: 干预机制 or 激励机制 is how a feature of the product works, not its technology. Read as technical,
  // 干预机制 took the architecture points (「采用“半Agent”架构……」) ahead of 算法技术, under a 实现机制 of its own.
  technical: /技术|架构|数据模型|实现机制|技术机制|系统机制|architecture|technical|data model/iu,
  security: /安全|security/iu,
  // 开发规划 is the development plan too: README rules sat under 采购 for want of a chapter called 开发计划.
  documentation: /文档|维护|开发(?:计划|规划)|发布|documentation|maintenance|development|release/iu,
  progress: /计划|进度|状态|发布|plan|progress|status|release/iu,
  stage: /规划|路线|里程碑|计划|roadmap|milestone|plan/iu,
  roadmap: /规划|路线|里程碑|计划|roadmap|milestone|plan/iu,
  // 规划 too: "开发规划与发布策略" holds the tests and the delivery rules ("每个 Phase 完成后必须通过 lint/typecheck……").
  quality: /测试|质量|验收|计划|规划|test|quality|validation|plan/iu,
  // Not 交互: a requirement example ("温度超过 28℃ 时蜂鸣器提醒") went to 界面设计与交互体验 for that word.
  example: /工作流|流程|示例|workflow|example/iu,
  // Matched against a subtopic's title as well: "商业化模式" sits under 市场增长与竞品.
  commerce: /商业化|商业模式|变现|定价|盈利|付费|收费|monetiz|pricing|business model|revenue/iu,
  algorithm: /算法|algorithm/iu,
};
const LABEL: Record<Lane, [string, string]> = { purpose: ["产品定位", "Product purpose"], interface: ["界面交互", "Interface"], technical: ["实现机制", "Implementation"], security: ["安全边界", "Security"], documentation: ["文档与维护", "Documentation"], progress: ["实现进度", "Progress"], stage: ["阶段安排", "Stages"], roadmap: ["开发路线", "Roadmap"], quality: ["验证与验收", "Validation"], example: ["使用示例", "Usage examples"], commerce: ["商业模式与定价", "Business model and pricing"], algorithm: ["算法机制", "Algorithms"] };
/** What is sold and how it is paid for: a store, a price, a membership. Its words in the label, and a sale in the point. */
const COMMERCE_LABEL = /商店|商城|商品|定价|价格|付费|支付|收费|会员|订阅|SKU|商业化|变现|pricing|payment|monetiz|subscription|\bstore\b/iu;
const COMMERCE_TEXT = /售卖|出售|销售|商品|SKU|付费|支付|价格|定价|会员|收费|订阅|变现|\d+\s*元|[¥￥]\s*\d|\b(?:sell|price|pay|paid|subscription)\b/iu;
/** How the product scores, ranks or predicts: a formula, weights, a recommendation order. */
const ALGORITHM_LABEL = /算法|评分公式|推荐(?:分数|排序|模型|逻辑|权重)|排序规则|权重|algorithm|scoring|ranking/iu;
/** A statement laying out a whole roadmap: so many phases or milestones, or three or more of them named in order. */
const ROADMAP_COUNT = /(?:分|按|共)\s*\d+\s*个\s*(?:Phase|阶段|里程碑|Milestone)/iu, ROADMAP_STEP = /(?:\bPhase\s*|\bM\s*|Milestone ?|第)\d+(?:\s*阶段)?/giu;
/** A roadmap subtopic, and a subtopic for tests, within one chapter. */
const ROADMAP_TOPIC = /路线图|里程碑|版本规划|开发路线|roadmap|milestone/iu, TESTS_TITLE = /测试|验收|质量|基准|test|quality|benchmark/iu;
/** A point telling what other products are or have: one about a named product, or a fact filed as a competitor or an
 * outside reference. */
const otherProducts = (unit: WikiKnowledgeUnit) => ["fact", "report", "history"].includes(unit.kind) && (Boolean(unit.about) || /竞品|外部参考|对标|competitor|outside reference/iu.test(`${unit.subject} ${unit.facet ?? ""}`));
/** A subtopic telling how the product is used: its users, retention, daily actives or other figures. */
const MEASURE_TOPIC = /留存|日活|DAU|活跃|用户数|数据指标|运营现状|增长现状|瓶颈|retention|active users|metrics/iu;
/** A screen of the product, named as one. */
const SCREEN = /首页|落地页|欢迎页|Landing\s*Page|Welcome\s*Screen|Hero|页面布局|\bpage\b/iu;
export const wikiRoadmap = (text: string) => ROADMAP_COUNT.test(text) || (text.match(ROADMAP_STEP) ?? []).length >= 3;
export function wikiUnitLane(unit: WikiKnowledgeUnit): Lane | undefined {
  if (unit.about) return undefined;
  const identity = `${unit.subject} ${unit.facet ?? ""}`, text = unit.statement;
  if (/示例|例子|\b(?:demo|example)\b/iu.test(identity) || /用户原始需求/u.test(unit.evidence.quote) && /结构化理解/u.test(unit.evidence.quote) && !/项目|产品|平台|界面|交互|字段|数据/u.test(text)) return "example";
  if (/文档|README|documentation/iu.test(identity) || /文档(?:重组|分层|结构)|PROJECT_OVERVIEW\.md/iu.test(text)) return "documentation";
  if (/进度|实现状态|已完成功能|completed features|project status/iu.test(identity) && /已完成|已实现|已通过|完成了|\b(?:implemented|completed|passed)\b/iu.test(text)) return "progress";
  // Tests and delivery rules ("开发工作流要求 · 交付标准", "视觉识别测试规范", "End-to-End HardwareBench"), wherever they were filed.
  if (/基准测试|验收|质量保障|成功标准|交付标准|开发工作流|测试规范|测试集|测试用例|benchmark|acceptance|quality assurance|definition of done/iu.test(identity) || /[A-Z][a-z]*Bench\b/u.test(identity)) return "quality";
  // A shop's own positioning ("商店策略 · 定位与原则": 定位为“守护工具箱”，售卖……SKU) is how the product earns, not what it
  // is: read as purpose, one run's SKU rule stood under 核心价值主张, beside the same paid flow under 商业化模式.
  if (COMMERCE_LABEL.test(identity) && COMMERCE_TEXT.test(text) && ["decision", "constraint", "plan", "mechanism"].includes(unit.kind)) return "commerce";
  if (TITLE.purpose.test(identity) && /定位|面向|服务|目标用户|核心价值|positioned|targets|built for/iu.test(text)) return "purpose";
  // A whole roadmap ("分 7 个 Phase：1.Foundation…", "开发按 7 个里程碑推进：静态 Canvas、……") belongs with the plans from any
  // chapter: one run told three of them, in the interface, architecture and plan chapters, none saying which holds.
  if (wikiRoadmap(text) && ["plan", "decision", "fact"].includes(unit.kind)) return "roadmap";
  // A stage of the work ("Milestone 5 · Alpha Validation": 冻结大功能 1-2 周) is a plan, whatever subject carried it.
  if (/Milestone\s*[\d.]+|\bPhase\s*[A-Z0-9]\b|里程碑|开发路线|开发阶段|阶段安排|开发顺序|roadmap/iu.test(identity) && ["plan", "decision"].includes(unit.kind)) return "stage";
  // What a version leaves out ("V0.1 范围 · 功能限制": 第一版禁止 PCB、STM32……) is that stage's scope, not a visual rule.
  if (/范围|功能限制|功能边界|\bscope\b/iu.test(identity) && PHASE.test(`${identity} ${text}`) && new RegExp(`${LEAVES_OUT}|仅支持|限定`, "u").test(text) && ["constraint", "decision", "plan"].includes(unit.kind)) return "stage";
  // How keys and the proxy are kept safe ("AI代理限制 · 后端安全", "密钥存储策略") belongs with the security rules. 安全
  // alone says less: "Transaction / Rollback · 安全机制" is how the IR is changed, "兼容性校验 · 安全约束" a buying rule.
  if (["mechanism", "constraint", "decision"].includes(unit.kind) && (/密钥|API\s*Key|代理|proxy|secret|凭证|credential/iu.test(identity)
    || /安全|security/iu.test(identity) && /密钥|API\s*Key|Proxy|代理|隐私|日志|持久化|\.env|secret|privacy/iu.test(text))) return "security";
  // How the screen looks ("Theme Toggle · 主题同步"): an interface rule, wherever its subject sat.
  if (/主题切换|Theme|Dark Mode|Light Mode|深色模式|浅色模式|配色|字体|字号|圆角|动效/iu.test(identity) && ["constraint", "decision", "mechanism"].includes(unit.kind)) return "interface";
  // A page's layout ("Landing Page · 视觉极简主义": 极简 Hero、输入框宽度) is the interface's.
  if (SCREEN.test(identity) && /布局|视觉|极简|宽度|居中|Hero|输入框|按钮|留白|layout/iu.test(`${unit.facet ?? ""} ${text}`) && ["constraint", "decision", "mechanism"].includes(unit.kind)) return "interface";
  // The code's layout ("项目目录结构": Next.js App Router, app/api, components) is the architecture's.
  // A screen's structure ("首页架构": 首页设计为“AI Agent指挥台……”的混合模式) is the interface's, not the architecture's.
  if (/数据模型|状态管理|密钥管理|存储|架构|目录结构|技术栈|tech stack|directory structure|schema|data model|key management|storage|architecture/iu.test(identity) && !SCREEN.test(identity)
    || unit.kind === "mechanism" && /\b(?:[a-z]+[A-Z]\w*|[A-Z]\w*(?:Adapter|Provider|Config|Store))\b/u.test(text)) return "technical";
  // A scoring formula or its rules ("个性化推荐算法 · 评分公式": 推荐分数由……加权计算) belongs with the algorithms: one run
  // put it, with its ActionEffectiveness structure, under 首页与导航设计.
  if (ALGORITHM_LABEL.test(identity) && ["mechanism", "constraint", "decision"].includes(unit.kind)) return "algorithm";
  // A score computed from weighted inputs (「系统根据时间、诱因、保护因素加权计算风险分数，分为……四个等级」) is the algorithm's,
  // whatever its subject: filed under 挑战营冷启动处理, it stood in the interface chapter beside the formula told again there.
  if (["mechanism", "constraint"].includes(unit.kind) && /加权计算|计算公式|评分公式|(?:风险|推荐)(?:分数|值|分)(?:由|按|的)?计算|计算(?:风险|推荐)(?:分数|值|分)/u.test(text)) return "algorithm";
}

/** The subtopic opened for what is sold, in the chapter already holding most of it that is not about the screens, the
 * technology or the algorithms; the one opened before, once there is one. */
function commerceHome(chapters: WikiKnowledgeOrganization["chapters"], subjects: WikiSubject[], units: Map<string, WikiKnowledgeUnit>, home: Map<string, WikiKnowledgeOrganization["chapters"][number]>): WikiSubject | undefined {
  const opened = subjects.find(subject => subject.id.endsWith(":role:commerce"));
  if (opened) return opened;
  const count = (chapter: WikiKnowledgeOrganization["chapters"][number]) => chapter.subtopics.flatMap(topic => topic.subjectIds).flatMap(id => subjects.find(subject => subject.id === id)?.unitIds ?? []).filter(id => { const unit = units.get(id); return unit && wikiUnitLane(unit) === "commerce"; }).length;
  const to = chapters.filter(chapter => !TITLE.interface.test(chapter.title) && !TITLE.technical.test(chapter.title) && !TITLE.algorithm.test(chapter.title) && !/相关项目|外部参考|参考项目|related project|outside reference/iu.test(chapter.title))
    .map(chapter => ({ chapter, held: count(chapter) })).filter(item => item.held > 0).sort((a, b) => b.held - a.held)[0]?.chapter;
  if (!to) return undefined;
  const id = `${to.id}:role:commerce`, label = LABEL.commerce[/\p{Script=Han}/u.test(to.title) ? 0 : 1];
  const target: WikiSubject = { id, name: label, aliases: [], unitIds: [] };
  subjects.push(target); home.set(id, to);
  // Ahead of the chapters' other products, after what the project does itself.
  const others = to.subtopics.findIndex(topic => /竞品|竞争|参考|competitor|alternative/iu.test(topic.title));
  to.subtopics.splice(others < 0 ? to.subtopics.length : others, 0, { title: label, subjectIds: [id] });
  return target;
}

/** Route individual points by their own role. A broad subject or explanation
 * group must not drag progress, documentation or a demo into product positioning. */
export function routeWikiUnits(organization: WikiKnowledgeOrganization, units: Map<string, WikiKnowledgeUnit>, report: Record<string, number> = {}): WikiKnowledgeOrganization {
  const chapters = organization.chapters.map(chapter => ({ ...chapter, subtopics: chapter.subtopics.map(topic => ({ ...topic, subjectIds: [...topic.subjectIds] })) }));
  const subjects = organization.subjects.map(subject => ({ ...subject, unitIds: [...subject.unitIds] }));
  const home = new Map(chapters.flatMap(chapter => chapter.subtopics.flatMap(topic => topic.subjectIds.map(id => [id, chapter] as const))));
  let moved = 0;
  for (const subject of [...subjects]) for (const id of [...subject.unitIds]) {
    const unit = units.get(id), from = home.get(subject.id), lane = unit && wikiUnitLane(unit);
    const reference = unit && !REFERENCE_CHAPTER.test(from?.title ?? "") && otherProducts(unit) ? chapters.find(chapter => chapter !== from && REFERENCE_CHAPTER.test(chapter.title)) : undefined;
    // What another product has (「海外存在DAWG和Stirden等……」, filed as 外部参考) joins the chapter on other products:
    // under the positioning it stood among the project's own points, apart from the competitors it was told with.
    if (unit && from && reference) {
      const into = fittingTopic(reference, unit, subjects, units) ?? reference.subtopics.find(topic => !topic.subjectIds.some(other => other.includes(":role:")));
      const target = into && subjects.find(other => other.id === into.subjectIds[0]);
      if (target) { subject.unitIds = subject.unitIds.filter(other => other !== id); target.unitIds.push(id); moved++; report.references_routed = (report.references_routed ?? 0) + 1; continue; }
    }
    if (!unit || unit.about || !from || !lane && !wikiMeasure(unit) || /相关项目|外部参考|参考项目|related project|outside reference/iu.test(from.title)) continue;
    // A test plan under the chapter's roadmap ("1. Phase 1…… 4. Benchmark 建设…… 6. E2E Benchmark……") joins the chapter's
    // testing subtopic: listed as roadmap steps, test suites read as stages of the product.
    if (lane === "quality" && TITLE.quality.test(from.title)) {
      const topic = from.subtopics.find(item => item.subjectIds.includes(subject.id)), tests = from.subtopics.find(item => item !== topic && TESTS_TITLE.test(item.title));
      const into = tests && subjects.find(other => other.id === tests.subjectIds[0]);
      if (topic && ROADMAP_TOPIC.test(topic.title) && into) { subject.unitIds = subject.unitIds.filter(other => other !== id); into.unitIds.push(id); moved++; }
      continue;
    }
    // A figure of use (「当前日活稳定在22人，其中15人为连续使用的核心用户」, 「新增用户留存率为19%」) under the interface
    // joins the subtopic that tells such figures: filed with the palette, it opened 「视觉风格定义」.
    if (TITLE.interface.test(from.title) && wikiMeasure(unit)) {
      const topic = from.subtopics.find(item => item.subjectIds.includes(subject.id));
      const measures = (item: typeof from.subtopics[number]) => item.subjectIds.flatMap(other => subjects.find(each => each.id === other)?.unitIds ?? []).filter(other => { const told = units.get(other); return told ? wikiMeasure(told) : false; }).length;
      const into = chapters.filter(chapter => !TITLE.interface.test(chapter.title)).flatMap(chapter => chapter.subtopics).filter(item => MEASURE_TOPIC.test(item.title) && !item.subjectIds.some(other => other.includes(":role:"))).sort((a, b) => measures(b) - measures(a))[0];
      const target = topic && into && subjects.find(other => other.id === into.subjectIds[0]);
      if (target) { subject.unitIds = subject.unitIds.filter(other => other !== id); target.unitIds.push(id); moved++; report.measures_routed = (report.measures_routed ?? 0) + 1; }
      continue;
    }
    if (!lane) continue;
    // What is sold and paid for joins the subtopic about earning, wherever that sits ("市场增长与竞品 › 商业化模式").
    if (lane === "commerce") {
      const topic = from.subtopics.find(item => item.subjectIds.includes(subject.id));
      if (!topic || TITLE.commerce.test(topic.title) || TITLE.commerce.test(from.title)) continue;
      const into = chapters.flatMap(chapter => chapter.subtopics).find(item => item !== topic && TITLE.commerce.test(item.title) && !item.subjectIds.some(other => other.includes(":role:")));
      let target = into && subjects.find(other => other.id === into.subjectIds[0]);
      // With no subtopic about earning, one is opened where most of what is sold already sits: the price plans and the
      // free/paid split stood under 首页信息架构 and AI Agent引擎, the confirmed subscription under 获客与裂变策略.
      if (!target) target = commerceHome(chapters, subjects, units, home);
      if (target && target !== subject) { subject.unitIds = subject.unitIds.filter(other => other !== id); target.unitIds.push(id); moved++; report.commerce_routed = (report.commerce_routed ?? 0) + 1; }
      continue;
    }
    if (TITLE[lane].test(from.title) && !(lane === "technical" && TITLE.purpose.test(from.title))) continue;
    // A formula told under the architecture is where the reader of the technology looks already.
    if (lane === "algorithm" && TITLE.technical.test(from.title)) continue;
    // A stage told under a technical or validation chapter may be that part's own milestone (Milestone 3.1 · BYOK): only
    // the interface and positioning chapters never hold one.
    if (lane === "stage" && !TITLE.interface.test(from.title) && !TITLE.purpose.test(from.title)) continue;
    // An interface rule leaves only a plan, validation or positioning chapter: under the architecture it may be a
    // rendering rule the architecture owns.
    // A page's own layout (首页 Hero) is never the architecture's.
    if (lane === "interface" && !TITLE.quality.test(from.title) && !TITLE.documentation.test(from.title) && !TITLE.purpose.test(from.title) && !(TITLE.technical.test(from.title) && SCREEN.test(`${unit.subject} ${unit.facet ?? ""}`))) continue;
    const candidates = chapters.filter(chapter => chapter !== from && TITLE[lane].test(chapter.title) && !/相关项目|外部参考|参考项目|related project|outside reference/iu.test(chapter.title));
    const to = candidates[0];
    if (!to) continue;
    const targetId = `${to.id}:role:${lane}`, label = LABEL[lane][/\p{Script=Han}/u.test(to.title) ? 0 : 1];
    // A test item joins the chapter's own testing subtopic (工程规范与测试要求) rather than opening another beside it.
    const testing = lane === "quality" ? to.subtopics.find(topic => TESTS_TITLE.test(topic.title)) : undefined;
    // Otherwise the planned subtopic whose points share most of its words: a heading of the role's own ("### 产品定位" in
    // 产品定位与用户价值, "### 实现机制", "### 阶段安排") stood beside the planned ones, repeating the chapter or saying nothing.
    const fitting = testing ?? fittingTopic(to, unit, subjects, units);
    let target = fitting ? subjects.find(subject => subject.id === fitting.subjectIds[0]) : subjects.find(subject => subject.id === targetId);
    if (!target) {
      target = { id: targetId, name: label, aliases: [], unitIds: [] }; subjects.push(target); home.set(targetId, to);
      to.subtopics.push({ title: label, subjectIds: [targetId] });
    }
    subject.unitIds = subject.unitIds.filter(other => other !== id); target.unitIds.push(id); moved++;
  }
  const subjectOf = new Map(subjects.flatMap(subject => subject.unitIds.map(id => [id, subject.id] as const)));
  const groups = organization.groups?.flatMap(group => {
    const anchor = units.get(group.anchorUnitId), anchorLane = anchor && wikiUnitLane(anchor), anchorHome = subjectOf.get(group.anchorUnitId);
    const members = group.members.filter(member => {
      const unit = units.get(member.unitId), lane = unit && wikiUnitLane(unit);
      if (!unit || !lane || statesCore(group.core, unit.statement)) return true;
      if (["documentation", "example", "progress", "quality"].includes(lane) && subjectOf.get(unit.id) !== anchorHome) return false;
      return !anchorLane || lane === anchorLane;
    });
    if (members.length !== group.members.length) report.group_role_separated = (report.group_role_separated ?? 0) + group.members.length - members.length;
    if (members.length < 2) return [];
    return [{ ...group, members, homeSubjectId: subjectOf.get(group.anchorUnitId) ?? group.homeSubjectId }];
  });
  if (moved) report.units_routed_by_role = moved;
  const live = new Set(subjects.filter(subject => subject.unitIds.length).map(subject => subject.id));
  // A routing hint must not leave an empty heading behind.
  const keptChapters = chapters.map(chapter => ({ ...chapter, subtopics: chapter.subtopics.map(topic => ({ ...topic, subjectIds: topic.subjectIds.filter(id => live.has(id)) })).filter(topic => topic.subjectIds.length) })).filter(chapter => chapter.subtopics.length);
  return { ...organization, subjects: subjects.filter(subject => live.has(subject.id)), chapters: keptChapters, ...(groups ? { groups } : {}) };
}

/** The chapter's planned subtopic a routed point belongs in: the one whose title and points share most of its words,
 * three or more. A subtopic routing made ("…:role:…") is no plan. */
const TOPIC_SHARED = 3;
function fittingTopic(chapter: WikiKnowledgeOrganization["chapters"][number], unit: WikiKnowledgeUnit, subjects: WikiSubject[], units: Map<string, WikiKnowledgeUnit>) {
  const own = knowledgeTerms(`${unit.subject} ${unit.facet ?? ""} ${unit.statement}`);
  let best: { topic: typeof chapter.subtopics[number]; shared: number } | undefined;
  for (const topic of chapter.subtopics) {
    if (topic.subjectIds.some(id => id.includes(":role:"))) continue;
    const held = topic.subjectIds.flatMap(id => subjects.find(subject => subject.id === id)?.unitIds.slice(0, 30) ?? []).flatMap(id => units.get(id) ?? []);
    const terms = knowledgeTerms(`${topic.title} ${held.map(other => `${other.subject} ${other.statement}`).join(" ")}`);
    let shared = 0; for (const term of own) if (terms.has(term)) shared++;
    if (shared >= TOPIC_SHARED && (!best || shared > best.shared)) best = { topic, shared };
  }
  return best?.topic;
}

/** Pick a source-owned home for a recovered point without inventing a chapter. */
export function wikiUnitHome(organization: WikiKnowledgeOrganization, unit: WikiKnowledgeUnit) {
  const owners = new Set(organization.subjects.filter(subject => subject.unitIds.includes(unit.id)).map(subject => subject.id));
  const exact = organization.chapters.find(chapter => chapter.subtopics.some(topic => topic.subjectIds.some(id => owners.has(id))));
  if (exact) return exact;
  const own = knowledgeTerms(`${unit.subject} ${unit.statement}`);
  return [...organization.chapters].sort((a, b) => [...knowledgeTerms(b.title)].filter(term => own.has(term)).length - [...knowledgeTerms(a.title)].filter(term => own.has(term)).length)[0];
}

/** A chapter named for the user's own direction (个人方向与学习路线) that holds none of it: its points are the project's
 * phases, milestones and checks, and the title sent the reader elsewhere. The personal points themselves stay out of the
 * Wiki (personalDirection), so such a chapter is named for what it holds. A chapter where they are a third or more keeps
 * its title. */
const PERSONAL_TITLE = /个人|学习路线|学习方向|职业|career|personal|learning path/iu, PERSONAL_SHARE = 1 / 3;
export function retitleMisnamedChapters(organization: WikiKnowledgeOrganization, units: Map<string, WikiKnowledgeUnit>, report: Record<string, number> = {}): WikiKnowledgeOrganization {
  const subjects = new Map(organization.subjects.map(subject => [subject.id, subject]));
  let renamed = 0;
  const taken = new Set(organization.chapters.map(chapter => chapter.title));
  const chapters = organization.chapters.map(chapter => {
    if (!PERSONAL_TITLE.test(chapter.title)) return chapter;
    const held = chapter.subtopics.flatMap(topic => topic.subjectIds.flatMap(id => subjects.get(id)?.unitIds ?? [])).flatMap(id => units.get(id) ?? []);
    if (!held.length || held.filter(unit => personalDirection(unit.statement)).length >= held.length * PERSONAL_SHARE) return chapter;
    const zh = /\p{Script=Han}/u.test(chapter.title), title = zh ? "开发计划与流程" : "Development plan";
    // Two such chapters were both renamed, and the directory listed "开发计划与流程" twice.
    if (taken.has(title)) return chapter;
    taken.add(title);
    renamed++;
    return { ...chapter, title, question: zh ? "项目按什么阶段和流程推进？" : "In what phases and steps does the work proceed?" };
  });
  if (!renamed) return organization;
  report.chapters_retitled = renamed;
  return { ...organization, chapters };
}

/** A chapter about competitors and references holding this project's own points (主题切换, the /api/generate flow, the
 * Mock AI stage, the Inspector's text, Auto Fix): routing passes such a chapter by, so they stayed and read as what
 * another product does. A point there that is about no other product, names none and is no comparison goes to the
 * chapter its role belongs in, or else to the subject elsewhere sharing most of its words. */
const REFERENCE_CHAPTER = /竞品|参考项目|外部参考|开源参考|competitor|reference/iu, COMPARES = /竞品|竞争|对手|标杆|差异化|区别于|避开|借鉴|参考|开源|许可|license|competitor/iu, HOME_SHARED = 2;
export function routeOutOfReferences(organization: WikiKnowledgeOrganization, units: Map<string, WikiKnowledgeUnit>, report: Record<string, number> = {}): WikiKnowledgeOrganization {
  const from = organization.chapters.find(chapter => REFERENCE_CHAPTER.test(chapter.title));
  if (!from) return organization;
  // A chapter only partly about other products ("增长运营与竞品参考") gives up points only from its comparison subtopics:
  // read whole, its retention, community and roadmap sections were scattered over the interface and algorithm chapters.
  const parts = from.title.split(/\s*(?:与|和|及|、|&|\band\b)\s*/iu).filter(Boolean);
  const mixed = parts.some(part => !REFERENCE_CHAPTER.test(part) && !COMPARES.test(part));
  const inFrom = new Set(from.subtopics.filter(topic => !mixed || REFERENCE_CHAPTER.test(topic.title) || COMPARES.test(topic.title)).flatMap(topic => topic.subjectIds));
  if (!inFrom.size) return organization;
  const products = [...new Set([...units.values()].flatMap(unit => unit.about && unit.about.role !== "other_project" ? unit.about.name.split(/[,，、/]/u).map(name => name.trim()).filter(name => name.length >= 2) : []))];
  const subjects = organization.subjects.map(subject => ({ ...subject, unitIds: [...subject.unitIds] }));
  const chapterOf = new Map(organization.chapters.flatMap(chapter => chapter.subtopics.flatMap(topic => topic.subjectIds.map(id => [id, chapter] as const))));
  const elsewhere = subjects.filter(subject => !inFrom.has(subject.id) && chapterOf.has(subject.id));
  const termsOf = new Map(elsewhere.map(subject => [subject.id, new Set(subject.unitIds.slice(0, 30).flatMap(id => [...knowledgeTerms(units.get(id)?.statement ?? "")]))]));
  let moved = 0;
  for (const subject of subjects.filter(item => inFrom.has(item.id))) for (const id of [...subject.unitIds]) {
    const unit = units.get(id);
    // A point opening on a product is about it ("灵犀造物已验证……"); one naming a library it uses is this project's ("……禁止
    // React Flow 背景残留白色").
    if (!unit || unit.about || COMPARES.test(unit.statement) || products.some(name => unit.statement.trim().toLocaleLowerCase().startsWith(name.toLocaleLowerCase()))) continue;
    const lane = wikiUnitLane(unit), laneChapter = lane ? organization.chapters.find(chapter => chapter !== from && TITLE[lane].test(chapter.title)) : undefined;
    const own = knowledgeTerms(unit.statement), fit = (other: WikiSubject) => { let shared = 0; for (const term of own) if (termsOf.get(other.id)?.has(term)) shared++; return shared; };
    const among = laneChapter ? elsewhere.filter(other => chapterOf.get(other.id) === laneChapter) : elsewhere;
    const home = [...among].sort((a, b) => fit(b) - fit(a))[0];
    if (!home || !laneChapter && fit(home) < HOME_SHARED) continue;
    subject.unitIds = subject.unitIds.filter(other => other !== id); home.unitIds.push(id); moved++;
  }
  if (!moved) return organization;
  report.references_routed_out = moved;
  const live = new Set(subjects.filter(subject => subject.unitIds.length).map(subject => subject.id));
  return { ...organization, subjects: subjects.filter(subject => live.has(subject.id)), chapters: organization.chapters.map(chapter => ({ ...chapter, subtopics: chapter.subtopics.map(topic => ({ ...topic, subjectIds: topic.subjectIds.filter(id => live.has(id)) })).filter(topic => topic.subjectIds.length) })) };
}
