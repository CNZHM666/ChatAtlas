import type { ProjectKnowledge } from "../context/types";
import { overviewChapterCards, type OverviewBasis, type ProjectOverviewWorkspace } from "../canvas/project-overview-workspace";
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
  {
    id: "workflow", platform: "claude", label: "Claude", day: 5,
    title: ["从需求澄清到操作预览", "From requirement clarification to plan preview"],
    messages: [
      ["我用温度提醒当示例。只填「温度过高就提醒」时，先问阈值和提醒方式。用户可以先改需求，再进入画布。", "Use a temperature alert as the walkthrough. If the request only says “alert me when it gets hot,” ask for the threshold and alert method. Let users revise the request before entering the canvas."],
      ["预览中可以把连接变更和行为变更分开列。确认按钮旁边说明本次会新增什么，并让用户可以返回修改。", "The preview can list wiring changes separately from behavior changes. Near the confirmation button, show what will be added and let the user go back and revise the plan."],
      ["确定预览要同时列出连线和行为变化。遇到错误时，反馈要说清哪一项失败、原因是什么，以及用户可以改哪里。", "The preview must list both wiring and behavior changes. On error, explain which change failed, why it failed, and what the user can modify."],
    ],
  },
  {
    id: "data", platform: "gemini", label: "Gemini", day: 7,
    title: ["项目数据与画布的职责", "Project data and canvas responsibilities"],
    messages: [
      ["同一个项目在画布和清单中各存一份，撤销后容易不同步。有没有更简单的办法？", "We store the same project twice, in the canvas and in the parts list, and they get out of sync after undo. Is there a simpler approach?"],
      ["保存元件、端点和连线，画布与清单从这些数据派生。计划可以携带它针对的项目版本，避免旧预览覆盖新改动。", "Store components, endpoints, and connections, and derive the canvas and parts list from that data. Attach the target project revision to the plan so an old preview cannot overwrite newer edits."],
      ["确认画布与零件清单从同一份项目数据生成。预览绑定项目版本，版本变化时让用户重新预览。", "Derive the canvas and parts list from the same project data. Bind previews to a project revision, and require a fresh preview if that revision changes."],
      ["每个操作带稳定的操作 ID，可以在校验反馈中回指。后续可评估导出时是否同时保留失败记录。", "Give each operation a stable ID so the validation result can point back to it. We can evaluate whether to include failure records in an export later."],
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
    evidenceIds: [...new Set(bindings.map(([message]) => byMessage.get(message)!.id))],
    claims: bindings.map(([message, statement, holder, workStatus]) => {
      const ref = byMessage.get(message)!;
      return { text: translate(statement), quote: ref.excerpt.split("\n\n", 1)[0], evidenceIds: [ref.id], verification: "supported" as const,
        holder, holderMark: true, workStatus, userDecided: holder === "decided" };
    }),
  });
  const sections = [
    section("release-scope", ["首版功能边界", "First-release scope"], [
      [
        "Circuit Studio 面向第一次尝试做硬件项目的用户。首版交付的是一个能查看、能修改、能校验的方案，用户可以在接线前先理解元件关系和行为条件。",
        "## 交付范围",
        "首版只做 ESP32 方案预览和基础校验，暂不控制实物，也不提供自动采购。方案预览包括元件清单、连接变化和用户确认后的操作计划。是否扩展到其他控制板，要等 ESP32 路径的错误反馈和恢复体验稳定后再评估。",
        "## 完成一条可验证路径",
        "用「温度过高就提醒」作为贯穿示例。用户补齐温度阈值和提醒方式，查看预览，再决定是否应用方案。能提交方案代表软件校验通过，实物接线效果仍需单独验证。",
      ].join("\n\n"),
      [
        "Circuit Studio is for people building their first hardware project. The first release produces a plan they can inspect, revise, and validate, so they can understand the parts and behavior before wiring anything.",
        "## Delivery scope",
        "Ship ESP32 plan previews and basic validation. Leave physical device control and automatic purchasing out. The preview covers the parts list, wiring changes, and the operation plan the user approves. Review support for other boards after the ESP32 error and recovery experience is stable.",
        "## One path to verify",
        "The running example is a temperature alert. The user fills in the threshold and alert method, inspects the preview, and decides whether to apply the plan. A successful commit proves the software checks passed. Physical wiring still needs separate verification.",
      ].join("\n\n"),
    ], [
      ["scope-2", ["首版只做 ESP32 方案预览和基础校验，暂不控制实物，也不提供自动采购。", "Leave physical device control and automatic purchasing out."], "decided"],
    ]),
    section("user-workflow", ["用户流程与反馈", "User workflow and feedback"], [
      [
        "## 先澄清需求",
        "用户从一段自然语言需求开始。若只说「温度过高就提醒」，先问阈值和提醒方式；用户补充后可以再修改原需求，然后进入项目画布。",
        "## 用户在预览中确认什么",
        "预览要同时列出连线和行为变化。连线区写出受影响的元件和端点，行为区显示触发条件与提醒方式。这样用户可以只改温度阈值，并确认原先的连线没有被意外改动。",
        "## 出错后如何继续",
        "遇到错误时，反馈要说清哪一项失败、原因是什么，以及用户可以改哪里。若引脚被重复占用，指出冲突的两项操作；用户改完方案后重新预览并确认。",
      ].join("\n\n"),
      [
        "## Clarify the request first",
        "The user starts with a natural-language request. If it only says “alert me when it gets hot,” ask for the threshold and alert method. The user can refine the request before opening the canvas.",
        "## What the user confirms",
        "The preview must list both wiring and behavior changes. The wiring section names the affected components and endpoints. The behavior section shows the trigger and alert method. A user can change the threshold and check that the wiring stayed the same.",
        "## How to continue after an error",
        "On error, explain which change failed, why it failed, and what the user can modify. If two operations use the same pin, show both operations so the user can revise the plan, preview it again, and confirm it.",
      ].join("\n\n"),
    ], [
      ["workflow-2", ["预览要同时列出连线和行为变化。", "The preview must list both wiring and behavior changes."], "decided"],
      ["validation-2", ["若引脚被重复占用，指出冲突的两项操作", "If two operations use the same pin, show both operations"], "material"],
    ]),
    section("project-data", ["项目数据与画布", "Project data and canvas"], [
      [
        "## 共用同一份数据",
        "画布与零件清单从同一份项目数据生成。项目记录元件、端点和连线，两个视图分别呈现结构与清单。历史原型分别维护两份数据，撤销后可能不同步。",
        "## 预览绑定项目版本",
        "预览绑定项目版本，版本变化时让用户重新预览。比如用户在另一个视图修改元件后，旧计划需要重新计算，确认时才能看到最新的变化。",
        "## 操作与校验结果如何关联",
        "讨论中建议为每个操作保留稳定 ID。这能让错误说明指回出问题的操作。是否在导出中附失败记录仍待评估。",
      ].join("\n\n"),
      [
        "## A shared project model",
        "Derive the canvas and parts list from the same project data. The model records components, endpoints, and connections. Separate views present the structure and the parts list. The prototype stored both independently, which could leave them out of sync after undo.",
        "## Preview against a revision",
        "Bind previews to a project revision, and require a fresh preview if that revision changes. If a user replaces a part in another view, the old plan needs to be recalculated before they approve its changes.",
        "## Link validation to operations",
        "The discussion suggested stable IDs for operations so an error can point to the exact step. Including failure records in exports is still up for evaluation.",
      ].join("\n\n"),
    ], [
      ["data-2", ["画布与零件清单从同一份项目数据生成。", "Derive the canvas and parts list from the same project data."], "decided"],
      ["data-2", ["预览绑定项目版本，版本变化时让用户重新预览。", "Bind previews to a project revision, and require a fresh preview if that revision changes."], "decided"],
    ]),
    section(architectureChapter, ["操作计划与校验", "Operation plans and validation"], [
      [
        "## 修改如何进入项目",
        "AI 只提出修改建议，用户确认之后，执行器才应用到画布。早期原型允许 AI 直接编辑，遇到错误引脚时却无法指出是哪一步破坏了项目。结构化预览现在先列出操作对象和执行顺序，确认后按同一份计划执行。",
        "## 提交与失败恢复",
        "只有整组操作通过校验才提交。失败时丢弃临时副本，保留原项目并定位到失败步骤。",
        "**校验与提交规则**",
        validationTable[0],
        "## 恢复后的重试",
        "以引脚冲突为例，先在预览里找到两项冲突操作。修正后重新核对操作顺序；通过校验才把画布和项目数据一起提交。执行中断可重新尝试，原来已保存的方案继续可用。",
      ].join("\n\n"),
      [
        "## How edits reach the project",
        "AI proposes edits, and the executor applies them to the canvas only after the user confirms. In the early prototype, direct AI edits made it hard to tell which operation introduced a bad pin. The preview now lists the objects and operation order, and the executor uses that same plan after approval.",
        "## Commit and recovery",
        "Commit only when the entire operation batch passes validation. On failure, discard the temporary copy, keep the original project, and point to the failed step.",
        "**Validation and commit rules**",
        validationTable[1],
        "## Review a retry",
        "For a pin conflict, locate both operations in the preview. After the correction, review the operation order again. A successful attempt commits the canvas and project data together. An interrupted attempt can be retried while the last saved plan stays available.",
      ].join("\n\n"),
    ], [
      ["architecture-2", ["AI 只提出修改建议，用户确认之后，执行器才应用到画布。", "AI proposes edits, and the executor applies them to the canvas only after the user confirms."], "decided"],
      ["validation-2", ["失败时丢弃临时副本，保留原项目并定位到失败步骤。", "On failure, discard the temporary copy, keep the original project, and point to the failed step."], "decided"],
    ]),
    section("verification", ["测试与后续评估", "Verification and open work"], [
      [
        "## 用户报告的进展",
        "预览、提交和回滚已通过软件夹具验证。无效引脚用例能定位到单个操作。实物接线还没验证。",
        "## 将失败场景纳入回归",
        "讨论中建议增加引脚重复占用和执行中断场景。测试时对照两个结果：失败后原项目应完整保留，校验信息应能回到对应操作。单独记录软件用例和实物结果，发布说明可据此明确验证范围。",
        "## 照片匹配如何进入下一阶段",
        "照片匹配尚未排入首版。需要确定匹配准确率和低置信度时的处理方式。第一批评估样本可以从无遮挡的单个模块照片开始。是否允许创建自定义元件也留待评估。",
      ].join("\n\n"),
      [
        "## Reported progress",
        "Preview, commit, and rollback were verified against software fixtures. The invalid-pin case points to the exact operation. Physical wiring hasn't been tested yet.",
        "## Add failure cases to regression tests",
        "The discussion suggested adding duplicate pin assignments and interrupted execution. Each check should verify that the original project survives and that validation points back to the affected operation. Record software and physical results separately so release notes can state what was verified.",
        "## Photo matching in a later release",
        "Photo matching is outside the first release. We still need an accuracy threshold and a plan for low-confidence matches. Start with unobstructed photos of individual modules. Support for creating custom components remains an open question.",
      ].join("\n\n"),
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
  const basis = (message: string): OverviewBasis => {
    const ref = byMessage.get(message)!;
    return { ref, quote: ref.excerpt.split("\n\n", 1)[0], text: ref.excerpt.split("\n\n", 1)[0] };
  };
  const photoQuestion = translate(["照片识别进入下一阶段时，首轮支持哪些元件？", "Which components should the first photo-matching trial support?"]);
  const overview: ProjectOverviewWorkspace = {
    questions: [{
      id: "photo-trial-scope", text: photoQuestion, kind: "writing", chapter: { id: "verification" }, basis: [basis("release-2")],
      options: [
        { id: "catalog", label: translate(["先匹配已有元件目录", "Match against the existing parts catalog first"]), unitIds: [], basis: [basis("release-1")] },
        { id: "custom", label: translate(["评估是否加入自定义元件", "Evaluate support for custom components"]), unitIds: [], basis: [basis("release-1")] },
      ],
    }],
    decisions: sections.flatMap(chapter => chapter.claims.filter(claim => claim.userDecided).map((claim, index) => ({
      id: chapter.id + "-" + index, text: claim.text, chapter: { id: chapter.id }, choice: undefined, receiptId: undefined,
      basis: claim.evidenceIds.map(id => basis(id.slice("source-".length))),
    }))),
    plan: undefined, planChoices: {}, planChapters: {}, chapterCards: overviewChapterCards(session, locale === "zh"),

  };
  return { knowledge, overview };
}
