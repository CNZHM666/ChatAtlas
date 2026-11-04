import { knowledgeTerms } from "../shared/knowledge-subject";
import { personalDirection, statesCore, type WikiKnowledgeOrganization, type WikiKnowledgeUnit, type WikiSubject } from "../shared/wiki-knowledge";

type Lane = "purpose" | "interface" | "technical" | "security" | "documentation" | "progress" | "stage" | "roadmap" | "quality" | "example";
const TITLE: Record<Lane, RegExp> = {
  purpose: /定位|用户价值|核心价值|positioning|purpose/iu,
  interface: /界面|交互|视觉|interface|interaction|visual/iu,
  technical: /技术|架构|数据模型|机制|architecture|technical|data model/iu,
  security: /安全|security/iu,
  // 开发规划 is the development plan too: README rules sat under 采购 for want of a chapter called 开发计划.
  documentation: /文档|维护|开发(?:计划|规划)|发布|documentation|maintenance|development|release/iu,
  progress: /计划|进度|状态|发布|plan|progress|status|release/iu,
  stage: /规划|路线|里程碑|计划|roadmap|milestone|plan/iu,
  roadmap: /规划|路线|里程碑|计划|roadmap|milestone|plan/iu,
  quality: /测试|质量|验收|计划|test|quality|validation|plan/iu,
  // Not 交互: a requirement example ("温度超过 28℃ 时蜂鸣器提醒") went to 界面设计与交互体验 for that word.
  example: /工作流|流程|示例|workflow|example/iu,
};
const LABEL: Record<Lane, [string, string]> = { purpose: ["产品定位", "Product purpose"], interface: ["界面交互", "Interface"], technical: ["实现机制", "Implementation"], security: ["安全边界", "Security"], documentation: ["文档与维护", "Documentation"], progress: ["实现进度", "Progress"], stage: ["阶段安排", "Stages"], roadmap: ["开发路线", "Roadmap"], quality: ["验证与验收", "Validation"], example: ["使用示例", "Usage examples"] };
/** A statement laying out a whole roadmap: so many phases or milestones, or three or more of them named in order. */
const ROADMAP_COUNT = /(?:分|按|共)\s*\d+\s*个\s*(?:Phase|阶段|里程碑|Milestone)/iu, ROADMAP_STEP = /(?:\bPhase\s*|\bM\s*|Milestone ?|第)\d+(?:\s*阶段)?/giu;
/** A screen of the product, named as one. */
const SCREEN = /首页|落地页|欢迎页|Landing\s*Page|Welcome\s*Screen|Hero|页面布局|\bpage\b/iu;
export const wikiRoadmap = (text: string) => ROADMAP_COUNT.test(text) || (text.match(ROADMAP_STEP) ?? []).length >= 3;
export function wikiUnitLane(unit: WikiKnowledgeUnit): Lane | undefined {
  if (unit.about) return undefined;
  const identity = `${unit.subject} ${unit.facet ?? ""}`, text = unit.statement;
  if (/示例|例子|\b(?:demo|example)\b/iu.test(identity) || /用户原始需求/u.test(unit.evidence.quote) && /结构化理解/u.test(unit.evidence.quote) && !/项目|产品|平台|界面|交互|字段|数据/u.test(text)) return "example";
  if (/文档|README|documentation/iu.test(identity) || /文档(?:重组|分层|结构)|PROJECT_OVERVIEW\.md/iu.test(text)) return "documentation";
  if (/进度|实现状态|已完成功能|completed features|project status/iu.test(identity) && /已完成|已实现|已通过|完成了|\b(?:implemented|completed|passed)\b/iu.test(text)) return "progress";
  if (/基准测试|验收|质量保障|成功标准|benchmark|acceptance|quality assurance/iu.test(identity)) return "quality";
  if (TITLE.purpose.test(identity) && /定位|面向|服务|目标用户|核心价值|positioned|targets|built for/iu.test(text)) return "purpose";
  // A whole roadmap ("分 7 个 Phase：1.Foundation…", "开发按 7 个里程碑推进：静态 Canvas、……") belongs with the plans from any
  // chapter: one run told three of them, in the interface, architecture and plan chapters, none saying which holds.
  if (wikiRoadmap(text) && ["plan", "decision", "fact"].includes(unit.kind)) return "roadmap";
  // A stage of the work ("Milestone 5 · Alpha Validation": 冻结大功能 1-2 周) is a plan, whatever subject carried it.
  if (/Milestone\s*[\d.]+|\bPhase\s*[A-Z0-9]\b|里程碑|开发路线|开发阶段|阶段安排|开发顺序|roadmap/iu.test(identity) && ["plan", "decision"].includes(unit.kind)) return "stage";
  // What a version leaves out ("V0.1 范围 · 功能限制": 第一版禁止 PCB、STM32……) is that stage's scope, not a visual rule.
  if (/范围|功能限制|功能边界|\bscope\b/iu.test(identity) && /第一版|首版|\bV\d|本阶段|当前阶段|\bMVP\b/iu.test(`${identity} ${text}`) && /禁止|不做|不支持|不包含|严禁|暂不|仅支持|限定/u.test(text) && ["constraint", "decision", "plan"].includes(unit.kind)) return "stage";
  // How keys and the proxy are kept safe ("AI代理限制 · 后端安全", "密钥存储策略") belongs with the security rules. 安全
  // alone says less: "Transaction / Rollback · 安全机制" is how the IR is changed, "兼容性校验 · 安全约束" a buying rule.
  if (["mechanism", "constraint", "decision"].includes(unit.kind) && (/密钥|API\s*Key|代理|proxy|secret|凭证|credential/iu.test(identity)
    || /安全|security/iu.test(identity) && /密钥|API\s*Key|Proxy|代理|隐私|日志|持久化|\.env|secret|privacy/iu.test(text))) return "security";
  // How the screen looks ("Theme Toggle · 主题同步"): an interface rule, wherever its subject sat.
  if (/主题切换|Theme|Dark Mode|Light Mode|深色模式|浅色模式|配色|字体|字号|圆角|动效/iu.test(identity) && ["constraint", "decision", "mechanism"].includes(unit.kind)) return "interface";
  // A page's layout ("Landing Page · 视觉极简主义": 极简 Hero、输入框宽度) is the interface's.
  if (SCREEN.test(identity) && /布局|视觉|极简|宽度|居中|Hero|输入框|按钮|留白|layout/iu.test(`${unit.facet ?? ""} ${text}`) && ["constraint", "decision", "mechanism"].includes(unit.kind)) return "interface";
  // The code's layout ("项目目录结构": Next.js App Router, app/api, components) is the architecture's.
  if (/数据模型|状态管理|密钥管理|存储|架构|目录结构|技术栈|tech stack|directory structure|schema|data model|key management|storage|architecture/iu.test(identity)
    || unit.kind === "mechanism" && /\b(?:[a-z]+[A-Z]\w*|[A-Z]\w*(?:Adapter|Provider|Config|Store))\b/u.test(text)) return "technical";
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
    if (!unit || unit.about || !from || !lane || /相关项目|外部参考|参考项目|related project|outside reference/iu.test(from.title)) continue;
    if (TITLE[lane].test(from.title) && !(lane === "technical" && TITLE.purpose.test(from.title))) continue;
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
    let target = subjects.find(subject => subject.id === targetId);
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
  const chapters = organization.chapters.map(chapter => {
    if (!PERSONAL_TITLE.test(chapter.title)) return chapter;
    const held = chapter.subtopics.flatMap(topic => topic.subjectIds.flatMap(id => subjects.get(id)?.unitIds ?? [])).flatMap(id => units.get(id) ?? []);
    if (!held.length || held.filter(unit => personalDirection(unit.statement)).length >= held.length * PERSONAL_SHARE) return chapter;
    renamed++;
    const zh = /\p{Script=Han}/u.test(chapter.title);
    return { ...chapter, title: zh ? "开发计划与流程" : "Development plan", question: zh ? "项目按什么阶段和流程推进？" : "In what phases and steps does the work proceed?" };
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
  const inFrom = new Set(from.subtopics.flatMap(topic => topic.subjectIds));
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
