# 交接：依据高亮准确性 + 材料阅读缓存（Codex）

日期：2026-10-23
协作方式：Claude 与 Codex 并行开发，按文件划分归属，互不修改对方的文件。

开始前请先阅读：根目录 `AGENTS.md`、`PRODUCT_PRINCIPLES.md`。不要修改 `src/shared/atlas/`，它是后端契约的副本，权威版本在 `DREWEAVE-BACKEND`。

---

## 0. 整体方案（便于理解你这部分的位置）

目标：长对话的 AI 整理更快、更稳，依据核对更可信，且不牺牲正文质量。

| 编号 | 内容 | 负责人 | 状态 |
|---|---|---|---|
| **X1** | 材料阅读结果改为持久保存，并提供缓存诊断 | **Codex** | 待开始 |
| **X2** | 依据高亮准确性（4 个问题）和角色一致性检查 | **Codex** | 待开始 |
| C1 | 目录完成后单独做一次标题编辑，消除"XX与XX"标题，与正文写作并行 | Claude | ✅ 已完成 |
| C2 | 材料阅读并发 | Claude | ✅ 已完成 |
| C3 | 目录归属错误在本地修复 | Claude | ❌ 不做（原因见第 0.1 节） |

### 0.1 Claude 的最新进度（2026-10-23）

分支 `claude/wiki-titles-speed`，已推送到 GitHub。`npm run check` 全部通过（3110 个测试）。

- **C2 并发：** 瓶颈不在 `atlas-ai.ts`。`executeBatches`（`src/ai/batch-executor.ts`）和读材料/目录共用的队列（`src/ai/directory-request-queue.ts`）各自把并发写死为 `Math.min(3, …)`，覆盖了 `AdaptiveConcurrency` 的自动调节（最高 6，遇到 429 减半）。现在这两处的上限都改为 `MAX_CONCURRENCY`。**`atlas-ai.ts` 的并发逻辑没有改动，这个文件你可以照原计划只改缓存部分。**
- **C1 标题修正：** 新增 `src/ai/wiki-title-pass.ts`。目录完成后发一次小请求，只修改并列式的部分名、章节名和子主题名。每个新标题在本地逐条校验，不合格就保留原标题；请求失败也不影响整理。这个请求和写正文并行，写正文时仍使用原标题，所以缓存照常可用；组装章节时再替换标题和正文里完全一致的 `## 小标题`。接入点在 `focus-coverage.ts` 的 `executeStage` 中。
- **C3 不做：** 目录中出现"重复或遗漏的材料归属"时，现有流程已经会发一个很小的修复请求（`wiki-ownership-repair.ts`），由模型为每条材料指定归属。如果改成在本地按标题或位置来指定，会违反代码中"不能按标题或位置决定归属"的原则，而能省下的时间只有几秒。
- **对你的影响：**
  - 你的任务（X1、X2）不依赖我的分支，请**从 `main` 开始**。
  - 我们改动的文件没有重叠，合并时不应该出现冲突。
  - 你对读材料缓存的修复（X1）和我提高的并发（C2）是互补的：X1 让再次生成时不必重新读材料，C2 让第一次生成读得更快。

最近一次真实运行（554 段材料，单个长对话）的耗时：
- 材料阅读：0–641 s，占全程约 75%，55 个请求，**没有一个命中缓存**。
- 目录：在读材料的同时进行，读完后又用了约 90 s。
- 正文写作：约 120 s，没有失败。

前后三次运行的阅读请求逐字节相同，却每次都重新付费读了一遍。X1 解决这个问题，重跑时预计可省下约 10 分钟。

---

## 1. 文件归属（避免冲突）

**Codex 可修改：**
- `src/ai/atlas-ai.ts`：仅限缓存读写路径，不改并发逻辑（见下方说明）
- `src/storage/ai-result-cache.ts`、`src/storage/db.ts`（如需新的 store）
- `src/shared/original-evidence-highlights.ts`
- `src/canvas/evidence-highlight.ts`
- `src/canvas/components/WorkspaceSourcePanel.tsx`、`WikiClaimSources.tsx`、`EvidenceReviewButton.tsx`、`WikiEvidence.tsx`、`SourceMessageContent.tsx`，以及它们的 CSS
- `src/canvas/components/ReaderConversation.tsx`：只允许为了位置属性做最小修改；它是 Reader 的通用渲染器，改动后必须跑 Reader 相关测试
- `src/canvas/project-knowledge-checks.ts`（3.3 中可选的接入）
- `src/ai/usage-analysis.ts`（只做第 2 节第 4 点的 CSV 字段）
- 以上文件对应的测试，以及新增的测试文件

**Claude 负责的文件，请不要改：**
- `src/ai/focus-coverage.ts`、`src/ai/wiki-topic-plan.ts`、`src/ai/wiki-outline-policy.ts`、`src/ai/wiki-topic-output.ts`、`src/ai/model-routing.ts`、`src/ai/wiki-plan-contract.ts`、`src/ai/wiki-directory.ts`
- `src/ai/batch-executor.ts`、`src/ai/directory-request-queue.ts`、`src/ai/wiki-title-pass.ts`，以及它们的测试
- 生成相关的提示词和校验器：`wiki-*-instructions.ts`、`src/shared/wiki-claims.ts`、`src/ai/focus-session.ts`

**说明：** `atlas-ai.ts` 第 81 行附近的并发上限（`AdaptiveConcurrency`）这次没有改动。如果之后需要改，Claude 会先和你沟通。你在这个文件里只改缓存相关的代码。

---

## 2. 任务 X1：阅读结果持久保存 + 缓存诊断

### 现状
- 响应缓存在 `semanticDecisionCache` 里，key 由 `atlas-ai.ts` 中的 `cacheIdentity()` 生成：哈希了版本号、命名空间、模型、角色、参数、system 和 prompt，**与运行 ID 无关**。
- `storage/ai-result-cache.ts` 按 `accessedAt` 做 LRU 淘汰，上限为 `AI_CACHE_MAX_ROWS=2000` 行、`AI_CACHE_MAX_BYTES=32MB`。只有 `providerId` 以 `focus-` 开头的记录（即检查点）不参与淘汰。
- 同一次运行内的重试能命中缓存（上一轮有 165 次命中），跨运行时 55 个阅读请求全部未命中。根因还**没有确认**，可能是 LRU 淘汰，也可能是别的原因。

### 要做的
1. **先查清根因，再修改。** 写一个测试，模拟"运行 A 写入阅读结果 → 写入大量其他缓存行 → 运行 B 发出相同的阅读请求"，确认 LRU 是否会淘汰阅读结果。另外检查 key 的计算是否有不稳定的输入，例如 `request.maxOutputTokens`、`temperature` 是否在两次运行之间变化。阅读请求的判定可以用 `model-routing.ts` 里的 `isReadingRequest(taskType, taskData(prompt))`，只调用它，不要修改。
2. **阅读结果持久保存：** 阅读结果（材料笔记）重新生成的成本最高，要么写入不参与 LRU 的存储，要么在 prune 时豁免。要求：
   - key 和现有 `cacheIdentity()` 保持一致，不能让旧缓存全部失效。
   - 设一个独立的总量上限，比如 64MB；超过后按"所属来源对话最久未使用"的顺序整组淘汰，而不是逐行淘汰。
   - 来源对话被删除时，对应的阅读结果可以一并清理。如果现有代码已有来源删除的钩子就挂上去；没有就不做，并在报告里说明。
3. **不能改变的行为：** `bypassCache` 的语义不变；同一请求并发时由 `inFlight` 共享结果的逻辑不变；只有通过 `request.validate` 的结果才能写入缓存（沿用现有写入时机）。
4. **诊断：** 在 AI 整理分析 CSV（`usage-analysis.ts` 的导出）里新增一列 `reading_cache_hits`，作为跨运行阅读复用的指标。如果改动面太大，就在报告里说明，不必强行加。

### 验收
- 新测试：运行 A 读完之后，再写入超过 2000 行或 32MB 的其他缓存，运行 B 发出相同阅读请求时，**provider 调用次数为 0**。
- 现有缓存相关测试全部通过（`atlas-ai.test.ts`、`prompt-cache.test.ts`、`focus-source-reuse.test.ts` 等）。

---

## 3. 任务 X2：依据高亮准确性（按 Claude 的分析重新设计）

> 之前这部分修过几次效果都不好。我的判断（看代码得出的推断）是：之前的修改调整的是 `relevance()` 的停用词和打分阈值，而真正的根因在架构上，**调参数修不好**。请按下面的设计实现，不要再调整打分。

### 3.1 根因

**根因 A：定位信息在中途被丢掉了（造成"高亮位置不准"）**

现在的高亮分两步走：
1. `originalEvidenceHighlights()` 在原始消息里找到正确的位置，但最后返回的只是**字符串**（`message.content.slice(...)`），位置信息丢掉了。
2. `WorkspaceSourcePanel` 调用 `evidenceTextRanges(root, quotes)`，拿这些字符串在**渲染后的 DOM 文本**里重新查找。查找时去掉了空白字符，做了 NFKC 归一化，用的是 `indexOf`，而且 `occurrence` 永远是 0。

所以第 1 步即使选对了，第 2 步也可能高亮到别处：
- 同一句话出现多次时，总是落在第一次出现的位置。
- 很短或很常见的引文（如"可以。""先这样"）会命中前面无关的内容。
- 原文中的 Markdown 标记（`**`、反引号、列表符号、链接语法、表格、公式）渲染后消失，导致找不到或错位。

**根因 B：没有区分"高亮的是谁的依据"（造成"高亮的句子不是这条结论的依据"）**
- 从章节或总览进入时，`explicit` 为空，系统会按章节标题的字面重合度挑 3 句来高亮。高亮出的往往只是"出现了同样的词"的句子，样式却和真正的引文一模一样。
- 从某条结论进入后，切到它的第 2 个来源时，`const explicit=current===reference?quote:undefined` 会把这条结论的引文丢掉，于是改为高亮同一章里其他结论的引文。

### 3.2 设计

**第 1 步：位置贯穿全程，不再按文字重新查找**
- `originalEvidenceHighlights()` 改为返回 `Array<{start:number;end:number;kind:"quote"|"context"|"related";claimIndex?:number}>`，其中 start、end 是在 `message.content` 中的偏移。如果需要兼容旧调用，可以另外保留一个返回字符串的包装函数。
- 渲染器已经有现成的位置信息：`ReaderMarkdown`（`src/canvas/components/ReaderConversation.tsx`）会给 `p, li, blockquote, h1–h6, table, pre` 加上 `data-reader-source-start` 和 `data-reader-source-end`，值是原始文本偏移（`sourceStart` 加上 mdast 的 offset）。但 `SourceMessageContent.tsx` 目前**没有传入 `sourceStart`**。请改为调用 `messagePresentation(..., locations=true)`，并把每个片段的 `sourceStart` 传给 `ReaderMarkdown`。（`messagePresentation` 已经支持 `locations` 参数。）
- 新的 DOM 定位方法：对每个 `{start,end}`，先找出 `data-reader-source-start ≤ start` 且 `end ≤ data-reader-source-end` 的**最内层块元素**，只在这个块里匹配。如果块内有多处相同文字，就数一下从块的起点到 `start` 之间，归一化后的引文出现了几次，以此确定第几次出现（`occurrence`）。引文跨越多个块时，按块拆开分别高亮。
- 兜底：块元素没有位置属性时（例如超长文本未格式化，或 `renderableConversationText` 改写过内容，此时 `text !== content`），在整条消息范围内按同样的方法计算 `occurrence`。**定位不到就不高亮，绝不高亮到别的地方。**

**第 2 步：每处高亮标明种类和归属**

| kind | 含义 | 样式 |
|---|---|---|
| `quote` | 某条结论的原文引文（`wikiQuoteRange` 能找到） | 强高亮；悬停显示所属结论，编号对应面板里的结论列表 |
| `context` | 引文所在的完整句子，只在引文很短（例如少于 12 个字）时补充 | 淡色底 |
| `related` | 按字面相关度猜出来的句子 | 虚线下划线，并显示"相关段落（未核对）"标签 |

各入口的行为：
- **从结论进入（`WikiClaimSources`）：** 这条结论的每个来源只显示这条结论自己的 `quote`。某个来源里找不到它的引文时，显示"该来源中未定位到此结论的引文"，**不借用**其他结论的引文。切换来源时，引文跟着结论走，而不是跟着 `reference` 走。
- **从章节或总览进入（`EvidenceReviewButton`）：** 显示所有引用了这条消息的结论引文（`quote`，带编号），并在面板顶部列出这些结论，点哪条就只高亮哪条。只有当没有任何结论引用这条消息时，才显示 `related`。
- 任何情况下，`related` 都不能和 `quote` 使用同一种样式。

### 3.3 角色一致性提示（不调用模型）

在依据面板里，对每条结论计算下面三个信号，只作提示，不修改结论，也不阻断阅读。

- **R1：结论说"用户决定"，但依据只有助手消息。** 判定条件：结论表达了用户的决定或确认（`projectKnowledgeView` 中该结论的 `adoption==="accepted"`，或文本匹配 `用户(?:已)?(?:决定|确认|选择|采用)|已确认|(?:decided|confirmed|adopted)`），并且所有能定位到引文的来源消息 `role` 都是 `assistant`。
  - 提示文案："引文来自助手消息，可能是建议而非用户决定"。
- **R2：用户粘贴的 AI 内容。** 判定条件：引文出现在用户消息里，但同一段归一化后的文字（建议至少 20 个字）也出现在同一对话**更早**的助手消息中。依据产品准则"粘贴建议的 user 消息不自动证明采纳"。
  - 提示文案："引文是用户粘贴的 AI 内容，不能单独证明已采纳"。
- **R3：把计划写成了已完成。** 判定条件：结论文本匹配完成类说法（可以复用 `src/shared/wiki-knowledge-prose.ts` 里 `completion` 的写法，但不要改动那个文件），而引文所在消息是助手消息，或者引文中出现"建议、计划、将、可以先"等措辞。
  - 提示文案："依据是计划或建议，不能证明已完成"。

如果有合适的地方可以接入，也可以把这三个信号加入 `src/canvas/project-knowledge-checks.ts` 的检查结果。

### 3.4 验收（必须有测试）
1. 同一句话在一条消息里出现两次、结论引的是第二次时，高亮落在第二次。
2. 很短的引文（如"可以。"）只在正确的块内高亮，不命中前面无关的"可以"。
3. 引文含 `**加粗**`、行内代码、列表项、链接文字时能正确定位，或者明确不高亮；不允许错位。
4. 在一条结论的第 2 个来源上，只高亮这条结论自己的引文；找不到时显示提示。
5. 从章节进入时，强高亮只来自结论引文；`related` 使用不同样式并带标签。
6. R1、R2、R3 各有正例和反例测试，例如：用户自己写的决定不触发 R1；用户原创、并非粘贴的内容不触发 R2。
7. 现有测试通过：`WikiEvidence.test.tsx`、`original-evidence-highlights.test.ts`、`WorkspaceSourcePanel` 相关测试，以及 Reader 渲染相关测试。

## 4. 工作约定

- 仓库：`https://github.com/CNZHM666/ChatAtlas`。
  - `main`：基线 `c0cdd6f`，加上本交接文档（`docs/handoff/` 已加入 `scripts/public-source.mjs` 的公开清单）。
  - `claude/wiki-titles-speed`：Claude 的 C1、C2，尚未合并。
- 只有公开清单内的文件可以被 git 跟踪；新增文件也必须在清单覆盖的范围内（`src/`、`scripts/` 下的文件自动包含），否则 `npm run check` 会失败。
- `AGENTS.md` 没有纳入 git（维护者专用），在 worktree 里看不到它，请到原工作目录 `C.AI` 下阅读。
- Claude 在 `C.AI` 目录的 `claude/wiki-titles-speed` 分支上开发。**Codex 不要在同一个工作目录里切换分支**，请使用独立的 worktree，例如先 `git fetch origin`，再 `git worktree add ../C.AI-codex -b codex/evidence-cache origin/main`，在那里开发，并在 worktree 中执行 `npm ci`。
- 完成后推送 `codex/evidence-cache` 分支，不要直接推送到 `main`。合并由用户决定。
- 风格和周边代码保持一致：紧凑写法、注释少而准、名称用英文。
- 每完成一个任务运行一次 `npm run check`（lint、类型检查、测试、构建、worker 检查、公开源码检查），全部通过后再交付。
- 不能为了让测试通过而改掉现有测试的意图。确实需要改断言时，在报告里说明原因。

## 5. 交付时请报告

1. 每个问题的根因，尤其是 X1 跨运行未命中缓存的原因，要附上证据，比如测试或日志。
2. 改动的文件列表和每个文件的作用。
3. 新增和修改的测试，以及修改测试的原因。
4. `npm run check` 的结果。
5. 没有完成或没能验证的部分。
