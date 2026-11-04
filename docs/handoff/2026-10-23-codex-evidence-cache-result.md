# Codex 交付：阅读缓存与依据定位

日期：2026-10-23。分支：`codex/evidence-cache`，从 main 开始，随后无冲突 rebase 到已合入 Claude C1/C2 的最新 main（a7ecff8）；未直接推送 main。

## 根因与证据

- X1：旧普通 LRU 会删除阅读结果。新增 `reading-cache.test.ts` 先在旧实现上失败：运行 A 保存后插入 2001 条较新普通记录，运行 B 相同请求又调用 provider 一次。修复后调用为零。该测试证明可复现的淘汰路径，不能据此断言历史真实运行的 55 次未命中全部由它造成；没有取得那几次运行的浏览器数据库快照。
- `cacheIdentity()` 未变，运行 ID 不参与；模型、角色、命名空间、策略版本、system、prompt、temperature、maxOutputTokens、repair 参数仍参与。参数变化合理地产生未命中；默认温度在入口处固定，实际 provider 输出预算在生成 key 之后计算，不是随机输入。已有参数隔离测试保留。
- X2：旧接口返回字符串，重新在 DOM 上全局查找时丢失位置；章节的字面相关句和引文混用样式；面板及父组件导航同时丢弃当前引文。现在保留原文偏移，限制在带位置的原文块中定位，并核对渲染文本；重复引文优先选择靠近保存 excerpt 的位置。渲染无法安全对应时不高亮。

## 实现文件

| 文件 | 作用 |
| --- | --- |
| `src/storage/ai-result-cache.ts` | 原 store 中增加兼容元数据；阅读结果独立 64MB 上限，按来源连接组的最近访问时间整组淘汰；普通缓存仍为 2000 行／32MB；旧阅读结果命中时原 key 升级 |
| `src/ai/atlas-ai.ts` | 仅缓存写入和触碰路径标记阅读来源；不改 key、并发、inFlight、bypassCache 和验证时机 |
| `src/ai/usage-analysis.ts` | CSV 增加 reading_cache_hits，只计本地阅读结果命中，不计 inFlight 和 provider 缓存；可作为重复运行复用指标，但不单独证明跨运行 |
| `src/shared/original-evidence-highlights.ts` | 偏移、种类、结论归属；短引文上下文；保留旧字符串包装用于兼容；R1/R2/R3 本地提示 |
| `src/canvas/evidence-highlight.ts` | 依原文块定位 DOM Range，跨块拆分；全文兜底要求可验证的文字对应 |
| `src/canvas/components/SourceMessageContent.tsx` | 传递已有原文片段位置；无需修改 Reader 通用渲染器 |
| `src/canvas/components/WorkspaceSourcePanel.tsx` | 结论列表与筛选、导航保持引文、定位失败提示、三类高亮、引文悬停归属、中英文角色提示；从本地加载关联来源核对角色 |
| `src/canvas/components/FocusWorkspace.tsx` | 两处导航回调不再清空 quote/claim；这是白名单之外的必要最小接线修复，否则真实入口仍然丢失结论 |
| `src/canvas/workspace-source-panel.css` | 强引文、淡上下文、虚线相关段落与结论列表样式 |
| `README.md`、`README.en.md` | 明确早期开发状态、最新产品职责与目标／实现区别、缓存与依据核对限制；移除英文中的旧项目上下文入口描述 |

## 测试

- 新增 `src/ai/reading-cache.test.ts`：运行 A → 普通 LRU 压力 → 运行 B，provider 零调用，诊断命中与 bypassCache。
- 扩展 `src/storage/ai-result-cache.test.ts`：64MB 来源连接组整体淘汰、普通缓存独立保留、旧 key 升级。
- 新增 `src/shared/original-evidence-offsets.test.ts`：重复引文、短引文上下文、强弱种类区分、R1/R2/R3 正反例。
- 新增 `src/canvas/components/SourceMessageContent.offsets.test.tsx`：加粗、行内代码、列表、链接、重复短句、跨块、拒绝变更渲染及无属性兜底。
- 扩展 `WorkspaceSourcePanel.test.tsx`：第二来源保留结论、未定位不借用其他结论、编号与筛选、角色提示、相关段落独立高亮。
- 旧 `original-evidence-highlights.test.ts` 仅将 import 指向保留的字符串包装，全部旧断言保持不变；新偏移接口另测。没有改写现有测试意图。
- 针对缓存、依据面板和 Reader 的 81 项测试通过；最终在最新 main 基线上执行 `npm run check` 全部通过：515 个测试文件、3130 项测试；lint、类型检查、生产构建、worker 检查和公开源码检查通过。保留已有的 ReadingStageList Fast Refresh 警告和大 chunk 构建警告（无错误）。

## 限制

- 未找到可订阅的来源删除钩子，未添加删除时的缓存清理；读取结果仍受 64MB 整组淘汰约束。没有修改数据库 schema、后端契约、Claude 负责的提示词、生成校验器或并发实现。
- 未调用真实收费模型，未验证历史 554 段材料的实际费用和加速幅度，也未做真实浏览器人工视觉验收。角色提示不修改结论，不替代用户核对；无法安全定位的 Markdown／公式片段保守地不高亮。
