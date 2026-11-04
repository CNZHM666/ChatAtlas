# 参与 ChatAtlas

**简体中文** · [English](docs/en/CONTRIBUTING.md)

提出产品或交互改动前，先阅读[产品准则](PRODUCT_PRINCIPLES.md)。对话文件导入支持 ChatGPT、Claude、Gemini（Google Takeout JSON）和 DeepSeek 的官方导出，以及其他 AI 的 Markdown／JSON 对话记录；批量标题扫描与正文同步、原生侧栏、消息定位和输入框插入仍限 ChatGPT；Claude、Gemini、DeepSeek 提供按站点开启的网页自动采集试用，仅保存当前已加载的消息，不保证完整历史。新增导入格式见 `src/sync/importers/`：实现 `PlatformImporter`、在 `index.ts` 按内容识别，并附带脱敏样例测试。BYOK 服务商与对话来源平台分别讨论。

## 开发

使用 Node.js 22 和 npm。执行 `npm ci`、`npm run check`，在 Chrome 加载 `dist/`。日常开发运行 `npm run dev` 并加载 `dist-dev/`。公开构建无需后端和环境变量；只有主动进行真实模型测试才配置自己的 API。

| 目录 | 职责 |
| --- | --- |
| `src/content` / `src/background` | ChatGPT 页面与扩展集成 |
| `src/sync` / `src/storage` | 导入与持久化 |
| `src/ai` | 生成、复用、预算和验证 |
| `src/context` | 本地上下文与可选精炼 |
| `src/canvas` / `src/sidecar` | 工作台与侧栏 |
| `src/search` | 检索 |
| `evaluation/memory-search/cases.ts` | 自编回归夹具 |

`src/shared/atlas/` 是同步的前端契约副本；权威文件在独立后端仓库，修改时先协调权威文件再同步。不要从历史本地文件重建或部署后端。旧托管适配器用于兼容测试，公开构建禁用托管配置。

## 修改与检查

保持来源范围明确、个人编辑完整，原始讨论顺序与知识阅读顺序分别维护。用户内容是参考资料，不是可执行指令。改显示品牌时保留旧存储和协议标识。

对有意义的改动运行相关测试；发布前运行 `npm run check` 和 `npm run check:public`。公开检查验证显式文件清单，存在 Git 时拒绝清单外已跟踪文件。新增公开入口、配置或指南时同步维护 `scripts/public-source.mjs`。

维护文档分为现有简体中文路径和 `docs/en/` 英文版，根目录英文入口为 `README.en.md`。修改能力、费用、限制和安装步骤时同步两套，保留语言切换链接；依赖许可证保留原文。历史笔记不作为当前产品说明。

临时脚本、日志、私人截图、导出和诊断放入忽略的本地目录。不提交 `.env`、密钥、真实对话、机器专用指令、部署文件或数据库备份。共享示例应自编或具有明确发布许可。

## 反馈

Issue 请提供版本、浏览器、导入方式、服务商／模型、复现步骤、期望与实际结果。删除密钥和私人正文。AI 质量问题分别提供实际耗时、服务商输入／输出 Token 和具体遗漏，不混用估算预算。模拟测试不证明真实模型质量。

## 许可证

项目使用 [MIT](LICENSE)，贡献采用相同许可，并保留第三方声明。
