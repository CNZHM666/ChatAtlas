import type { ProjectKnowledge } from "../context/types";
import type { FocusSession } from "../shared/focus-session";
import { sourceMessageSignature } from "../shared/source-signature";
import type { Conversation, ConversationMessage } from "../shared/types";
import type { WikiClaim } from "../shared/wiki-claims";

export const architectureChapter = "operation-plans";
export type DemoLocale = "zh" | "en";
type Localized = readonly [zh: string, en: string];
const validationTable: Localized = [
  "| 情况 | 处理方式 | 项目结果 |\n| --- | --- | --- |\n| 引脚不存在 | 停止并定位到对应操作 | 保留原项目 |\n| 引脚重复占用 | 提示冲突的两项操作 | 保留原项目 |\n| 执行中断 | 丢弃临时副本，允许重试 | 保留原项目 |\n| 整组校验通过 | 一次提交全部变更 | 更新画布和项目数据 |",
  "| Condition | Response | Project state |\n| --- | --- | --- |\n| Pin does not exist | Stop and identify the operation | Keep the original |\n| Duplicate pin assignment | Point out both conflicting operations | Keep the original |\n| Execution interrupted | Discard the temporary copy and allow retry | Keep the original |\n| Every check passes | Commit all changes together | Update the canvas and project data |",
];

const discussions: { id: string; platform: string; label: string; day: number; title: Localized; messages: readonly Localized[] }[] = [
  {
    id: "scope", platform: "chatgpt", label: "ChatGPT", day: 1,
    title: ["首版范围", "First-release scope"],
    messages: [
      ["我想做一个给初学者的硬件工作台。输入需求后，希望他们能先看懂方案，再决定要不要执行。", "I want a hardware workbench for beginners. They should understand the plan before deciding whether to run it."],
      ["先用 ESP32 和少量内置元件验证完整路径。直接控制实体设备、自动采购和其他控制板都可以留到后面。", "Start with an ESP32 and a small parts catalog. Direct device control, automatic purchasing, and other boards can wait."],
      ["确认首版只做 ESP32 方案预览和基础校验，暂不控制实物，也不提供自动采购。", "For the first release, ship ESP32 plan previews and basic validation. Leave physical device control and automatic purchasing out."],
    ],
  },
  {
    id: "architecture", platform: "claude", label: "Claude", day: 4,
    title: ["从直接改画布到可审查计划", "From direct edits to reviewable plans"],
    messages: [
      ["早期原型让 AI 直接修改画布，但模型返回错误引脚时，用户看不出哪一步改坏了项目。", "The prototype let AI edit the canvas directly. When the model suggested an invalid pin, users couldn't tell which operation broke the project."],
      ["可以把计划和执行拆开。先预览结构化操作，确认后再提交到确定性执行器。", "Split planning from execution. Preview structured operations first, then pass them to a deterministic executor after confirmation."],
      ["确认采用结构化操作计划。AI 只提出修改建议，用户确认之后，执行器才应用到画布。", "Use structured operation plans. AI proposes edits, and the executor applies them to the canvas only after the user confirms."],
      ["这样可以在预览里展示操作对象和顺序，并在执行时按同一份计划报告校验结果。", "That lets the preview show the affected objects and operation order, and lets the executor report validation results against the same plan."],
    ],
  },
  {
    id: "validation", platform: "gemini", label: "Gemini", day: 8,
    title: ["校验规则与失败恢复", "Validation and failure recovery"],
    messages: [
      ["确认过的计划执行到一半失败时，怎样避免界面和项目数据不一致？", "If a confirmed plan fails halfway through execution, how do we keep the interface and project data consistent?"],
      ["建议先做引脚存在性与重复占用检查，再在临时副本运行整组操作。正式项目只接收一次提交。", "Check pin existence and duplicate assignments first, then run the operations on a temporary copy. The live project receives a single commit."],
      [
        "确认失败时丢弃临时副本，保留原项目并定位到失败步骤。只有整组操作通过校验才提交。\n\n" + validationTable[0],
        "On failure, discard the temporary copy, keep the original project, and point to the failed step. Commit only when the entire operation batch passes validation.\n\n" + validationTable[1],
      ],
      ["回归测试可以覆盖无效引脚、重复占用和执行中断。实物接线仍应单独验证。", "Regression tests can cover invalid pins, duplicate assignments, and interruption. Physical wiring should still be validated separately."],
    ],
  },
  {
    id: "release", platform: "chatgpt", label: "ChatGPT", day: 12,
    title: ["测试进展与下一阶段", "Test results and next steps"],
    messages: [
      ["我在软件夹具里验证了预览、提交和回滚。无效引脚用例能定位到单个操作。实物接线还没验证，别写成已经完成。", "I verified preview, commit, and rollback against software fixtures. The invalid-pin case points to the exact operation. Physical wiring hasn't been tested yet."],
      ["下一阶段可以把照片匹配到已有元件目录，并请用户确认匹配结果。是否加入自定义元件可以单独评估。", "A next step could match photos against the existing parts catalog and ask the user to confirm. Custom components can be evaluated separately."],
      ["先记录为评估项，暂未排入首版。需要确定匹配准确率和低置信度时的处理方式。可以先收集无遮挡的单个模块照片作为样本。", "Record this as an evaluation item outside the first release. We still need an accuracy threshold and a plan for low-confidence matches. We can start with unobstructed photos of individual modules."],
    ],
  },
];

export function demoProject(locale: DemoLocale) {
  const translate = (pair: Localized) => pair[locale === "zh" ? 0 : 1];
  const timestamp = (day: number) => Date.UTC(2026, 9, day);
  const platforms = new Map(discussions.map(chat => [chat.id, chat.label]));
  const conversations: Conversation[] = discussions.map(chat => ({
    id: chat.id, title: translate(chat.title), platform: chat.platform, url: "", messageCount: chat.messages.length,
    updatedAt: timestamp(chat.day), hydrationState: "hydrated", importState: "complete",
  }));
  const messages: ConversationMessage[] = discussions.flatMap(chat => chat.messages.map((pair, index) => {
    const content = translate(pair);
    const time = timestamp(chat.day) + index * 60_000;
    return { id: chat.id + "-" + index, conversationId: chat.id, role: index % 2 ? "assistant" : "user",
      content, preview: content, messageIndex: index, contentHash: sourceMessageSignature(content), createdAt: time, updatedAt: time };
  }));
  const evidence = messages.map(message => ({
    id: "source-" + message.id, conversationId: message.conversationId, messageId: message.id, excerpt: message.content,
    sourceSignature: message.contentHash, title: platforms.get(message.conversationId) + " · " + conversations.find(chat => chat.id === message.conversationId)!.title,
  }));
  const byMessage = new Map(evidence.map(ref => [ref.messageId, ref]));
  const section = (id: string, title: Localized, body: Localized, bindings: readonly (readonly [string, Localized, WikiClaim["holder"], WikiClaim["workStatus"]?])[]) => ({
    id, title: translate(title), kind: "finding" as const, transition: "", body: translate(body),
    evidenceIds: bindings.map(([message]) => byMessage.get(message)!.id),
    claims: bindings.map(([message, statement, holder, workStatus]) => {
      const ref = byMessage.get(message)!;
      return { text: translate(statement), quote: ref.excerpt.split("\n\n", 1)[0], evidenceIds: [ref.id], verification: "supported" as const,
        holder, holderMark: true, workStatus, userDecided: holder === "decided" };
    }),
  });
  const sections = [
    section(architectureChapter, ["操作计划与校验", "Operation plans and validation"], [
      [
        "## 修改如何进入项目",
        "AI 只提出修改建议，用户确认之后，执行器才应用到画布。早期原型允许 AI 直接编辑，遇到错误引脚时却无法指出是哪一步破坏了项目。结构化预览现在先列出操作对象和执行顺序，确认后按同一份计划执行。",
        "## 提交与失败恢复",
        "只有整组操作通过校验才提交。失败时丢弃临时副本，保留原项目并定位到失败步骤。",
        "**校验与提交规则**",
        validationTable[0],
      ].join("\n\n"),
      [
        "## How edits reach the project",
        "AI proposes edits, and the executor applies them to the canvas only after the user confirms. In the early prototype, direct AI edits made it hard to tell which operation introduced a bad pin. The preview now lists the objects and operation order, and the executor uses that same plan after approval.",
        "## Commit and recovery",
        "Commit only when the entire operation batch passes validation. On failure, discard the temporary copy, keep the original project, and point to the failed step.",
        "**Validation and commit rules**",
        validationTable[1],
      ].join("\n\n"),
    ], [
      ["architecture-2", ["AI 只提出修改建议，用户确认之后，执行器才应用到画布。", "AI proposes edits, and the executor applies them to the canvas only after the user confirms."], "decided"],
      ["validation-2", ["失败时丢弃临时副本，保留原项目并定位到失败步骤。", "On failure, discard the temporary copy, keep the original project, and point to the failed step."], "decided"],
    ]),
    section("release-scope", ["首版功能边界", "First-release scope"], [
      "## 交付范围\n\n首版只做 ESP32 方案预览和基础校验，暂不控制实物，也不提供自动采购。用户先阅读方案，再决定是否执行。\n\n## 后续评估\n\n照片识别要先确定准确率和低置信度时的处理方式，再决定是否纳入后续版本。",
      "## Delivery scope\n\nShip ESP32 plan previews and basic validation. Leave physical device control and automatic purchasing out. Users review the plan before deciding whether to run it.\n\n## Future evaluation\n\nSet an accuracy threshold and a process for low-confidence photo matches before deciding whether to include them in a later release.",
    ], [
      ["scope-2", ["首版只做 ESP32 方案预览和基础校验，暂不控制实物，也不提供自动采购。", "Leave physical device control and automatic purchasing out."], "decided"],
      ["release-2", ["照片识别要先确定准确率和低置信度时的处理方式，再决定是否纳入后续版本。", "Set an accuracy threshold and a process for low-confidence photo matches before deciding whether to include them in a later release."], "open"],
    ]),
    section("verification", ["测试与后续评估", "Verification and open work"], [
      "## 用户报告的进展\n\n预览、提交和回滚已通过软件夹具验证。无效引脚用例能定位到单个操作。实物接线还没验证。\n\n## 后续评估\n\n照片匹配尚未排入首版。需要确定匹配准确率和低置信度时的处理方式。第一批评估样本可以从无遮挡的单个模块照片开始。",
      "## Reported progress\n\nPreview, commit, and rollback were verified against software fixtures. The invalid-pin case points to the exact operation. Physical wiring hasn't been tested yet.\n\n## Open work\n\nPhoto matching is outside the first release. We still need an accuracy threshold and a plan for low-confidence matches. Unobstructed photos of individual modules are a starting point for the first evaluation set.",
    ], [
      ["release-0", ["实物接线还没验证。", "Physical wiring hasn't been tested yet."], "user", "reported"],
      ["release-2", ["需要确定匹配准确率和低置信度时的处理方式。", "We still need an accuracy threshold and a plan for low-confidence matches."], "open"],
    ]),
  ];
  const session: FocusSession = {
    id: "circuit-studio-demo", title: "Circuit Studio", mode: "work", locale: locale === "zh" ? "zh-CN" : "en",
    goal: translate(["整理首版设计、执行约束和测试进展", "Document the first release, execution constraints, and test progress"]),
    sourceConversationIds: conversations.map(chat => chat.id), evidence, sections, activeSectionId: architectureChapter,
    completedSectionIds: [], notes: "", createdAt: timestamp(1), updatedAt: timestamp(12),
    sourceSignatures: Object.fromEntries(conversations.map(chat => [chat.id, Object.fromEntries(messages.filter(message => message.conversationId === chat.id).map(message => [message.id, message.contentHash]))])),
    sourceRoles: Object.fromEntries(conversations.map(chat => [chat.id, Object.fromEntries(messages.filter(message => message.conversationId === chat.id).map(message => [message.id, message.role]))])),
    sourceMessageOrder: Object.fromEntries(conversations.map(chat => [chat.id, messages.filter(message => message.conversationId === chat.id).map(message => message.id)])),
    brief: {
      summary: translate(["面向硬件初学者的工作台。用户先预览 ESP32 方案，确认后执行，再查看校验结果。", "A hardware workbench for beginners. Users preview an ESP32 plan, confirm it, and inspect the validation results."]),
      turningPoints: [], confirmed: [], openQuestions: [],
    },
  };
  const knowledge: ProjectKnowledge = { session, conversations, messages, sourcesStale: false, signature: "circuit-studio-" + locale };
  return { knowledge, platforms };
}
